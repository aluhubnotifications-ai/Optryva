/**
 * The "Brain": Immediate Action Engine.
 *
 * Process a user message and return a structured response that the client can
 * execute immediately (inject data, navigate, etc.) — no confirmation card.
 *
 * Uses the LLM abstraction layer (./llm) so the provider is swappable.
 * - Structured output returns { text, actions } reliably from a JSON schema.
 * - Includes conversation history so the assistant is genuinely conversational.
 * - Detects URLs in the message and runs deepInspect, folding the evidence into
 *   an add_evidence action.
 * - Falls back gracefully when no provider is configured (canned reply).
 * - Persists every message + action for audit (spec §8).
 */
import { sb, must, j } from '@/db'
import { generateStructured, hasAI } from './llm'
import { deepInspect, getFixed40Matches } from './tools'
import { getStudentContext, getEmployerContext, getUniversityContext } from './context'
import type { AssistantMode, AssistantResponse, AssistantAIOutput, AssistantAction } from './types'

/** JSON Schema that constrains the structured output. */
const RESPONSE_SCHEMA = {
  type: 'object' as const,
  properties: {
    text: { type: 'string' as const, description: 'The assistant reply to show in the chat.' },
    actions: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
           type: { type: 'string' as const, enum: ['inject_data', 'navigate', 'update_profile', 'add_evidence', 'create_job', 'start_shortlist'] },
          target: { type: 'string' as const, description: 'Where the action applies — a component name, DB table, or route path.' },
          data: { type: 'object' as const, additionalProperties: true },
        },
        required: ['type', 'target', 'data'],
      },
    },
  },
  required: ['text', 'actions'],
  additionalProperties: false,
}

const URL_REGEX = /https?:\/\/[^\s<"')]+/g

/** Build the system prompt for a given mode + context. */
function buildSystemPrompt(mode: AssistantMode, context: string, pageContext?: string): string {
  const modeName = { student: 'Student', employer: 'Employer', university: 'University' }[mode]
  let prompt = `You are the Optryva Assistant — a concise AI helper for the ${modeName} internship platform.\n\n`
  prompt += `Keep replies short: 1-2 sentences max. No markdown formatting (no *, **, #, bullets).\n`
  prompt += `Do not list generic capabilities. Act on what the user actually asked.\n\n`
  prompt += `When the user asks to create, add, update, or modify data, include an 'inject_data' action with the right 'target' so the app updates instantly:\n`
  prompt += `- inject_data target='profile_skills' data={skills: [...], mode: 'add'|'replace'}\n`
  prompt += `- inject_data target='job_editor' data={job: {...}} — opens the create/edit form with fields pre-filled\n`
  prompt += `- inject_data target='resume' data={...}\n`
  prompt += `- navigate target='/app/jobs' (student job browse) or '/app/listings' (employer job postings)\n`
  prompt += `- navigate target='/app/listings/new' (employer: create job), '/app/listings' (employer: view/edit postings), '/app/applications/:id/assessment' (student: take test)\n`
  prompt += `- navigate target='/app/insights' (employer: shortlist) or '/app/profile' (edit profile)\n`
  prompt += `- update_profile data={skills: [...], full_name: '...'}\n`
   prompt += `- add_evidence data={url, title, skills: [...], achievements: [...]}\n`
   prompt += `- start_shortlist target='{job_id}' data={job_id: string} — triggers Smart Shortlist for a job posting (employer); opens candidates from Smart Shortlist\n\n`
  prompt += `GROUNDING CONTEXT:\n${context}\n\n`
  if (pageContext) {
    prompt += `CURRENT PAGE: ${pageContext}\n\n`
  }
  prompt += `Return ONLY a JSON object: {"text":"short reply","actions":[...]}`
  return prompt
}

/** Turn recent message rows into a chat-style history string. */
function formatHistory(rows: any[]): string {
  if (!rows?.length) return ''
  return rows
    .map((r) => {
      const role = r.role === 'assistant' ? 'assistant' : r.role === 'user' ? 'user' : 'system'
      return `[${role}] ${String(r.content).slice(0, 2000)}`
    })
    .join('\n')
}

/** Extract URLs from a message so we can deep-inspect them. */
function extractUrls(message: string): string[] {
  const matches = message.match(URL_REGEX)
  return matches ? Array.from(new Set(matches)) : []
}

/** Resolve or create an assistant session for the user. */
async function resolveSession(userId: string, mode: AssistantMode, sessionId?: string): Promise<string> {
  if (sessionId) {
    const existing = must(
      await sb
        .from('assistant_sessions')
        .select('id')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .maybeSingle(),
    ) as { id: string } | null
    if (existing) return existing.id
  }
  const res = await sb
    .from('assistant_sessions')
    .insert({ user_id: userId, mode })
    .select('id')
    .single()
  return (must(res) as { id: string }).id
}

/** Fetch the last N messages for a session. */
async function fetchHistory(sessionId: string): Promise<any[]> {
  const res = await sb
    .from('assistant_messages')
    .select('role, content, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(20)
  return (must(res) as any[]).reverse()
}

/** Persist a message + its actions. */
async function saveMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  actions: AssistantAction[] = [],
): Promise<void> {
  try {
    await sb.from('assistant_messages').insert({
      session_id: sessionId,
      role,
      content,
      actions: JSON.stringify(actions),
    })
  } catch { /* non-critical — continue without persistence */ }
}

const FALLBACK_REPLY = "I'm here to help with your internship journey. What would you like me to do?"

/**
 * Simple intent handler for when no AI provider is configured or the AI
 * returned an unusable response. Answers basic data queries directly from
 * the database so the assistant isn't just replying with a generic message.
 */
async function fallbackIntentHandler(
  userId: string,
  mode: AssistantMode,
  message: string,
): Promise<{ text: string; actions: AssistantAction[] } | null> {
  const lower = message.toLowerCase().trim()

  if (/\b(hello|hi|hey)\b/i.test(message) && !lower.includes('shortlist') && !lower.includes('candidate') && !lower.includes('job') && !lower.includes('intern')) {
    return { text: "Hi! I'm the Optryva Assistant. Ask me about your jobs, applications, skills, or profile.", actions: [] }
  }

  // Student: "what jobs/applications do I have", "my skills", "my profile"
  if (mode === 'student') {
    if (lower.includes('assessment')) {
      return {
        text: "To complete your assessment: navigate to your application, open the Assessment tab, review any instructions from the employer, and submit your response before the deadline.",
        actions: [{ type: 'navigate', target: '/app/applications', data: {} }],
      }
    }

    if (lower.includes('job') || lower.includes('intern') || lower.includes('opportunit') || lower.includes('application')) {
      const { data: apps } = await sb
        .from('applications')
        .select('id, jobs!inner(title, company_name), status, created_at')
        .eq('student_id', userId)
        .order('created_at', { ascending: false })
        .limit(20)

      if (!apps || apps.length === 0) {
        return { text: "You haven't applied to any internships yet.", actions: [{ type: 'navigate', target: '/app/jobs', data: {} }] }
      }

      const summary = apps.slice(0, 5).map((a: any) => `  ${a.jobs?.title ?? 'Role'} — ${a.status}`).join('\n')
      const more = apps.length > 5 ? `...and ${apps.length - 5} more.` : ''
      return { text: `You have ${apps.length} application(s):\n${summary}\n${more}`, actions: [{ type: 'navigate', target: '/app/applications', data: {} }] }
    }

    if (lower.includes('skill')) {
      const { data: profile } = await sb.from('profiles').select('skills').eq('id', userId).maybeSingle()
      const skills = j.parse<string[]>(profile?.skills, [])
      if (!skills.length) return { text: "Your profile doesn't have any skills listed yet.", actions: [] }
      return { text: `Your skills: ${skills.join(', ')}`, actions: [{ type: 'navigate', target: '/app/profile', data: {} }] }
    }
  }

  // Employer/University: handle create requests first, then listing queries
  if (mode === 'employer' || mode === 'university') {
    if (lower.includes('create') || lower.includes('new') || lower.includes('draft')) {
      if (lower.includes('document') || lower.includes('file') || lower.includes('pdf') || lower.includes('upload') || lower.includes('do it for you') || lower.includes('generate')) {
        return {
          text: "Opening the job editor with instructions:\n1. Paste your job description or click the AI generator to create from scratch\n2. Upload a document (PDF/doc) using the file upload in the editor — the AI will extract key requirements\n3. Fill in location, pay, tags\n4. Save the draft, then add an assessment if needed\n5. Preview and post when ready",
          actions: [{ type: 'navigate', target: '/app/listings/new', data: {} }],
        }
      }
      return {
        text: "Opening the job editor. Here's what to fill in:\n1. Job title (e.g. Intern Management)\n2. Description — paste the full role description\n3. Location, listing type, tags, pay\n4. Click Save to create the draft\n5. Then add an assignment for assessments if needed",
        actions: [{ type: 'navigate', target: '/app/listings/new', data: {} }],
      }
    }

    if (lower.includes('assessment') || lower.includes('assignment') || lower.includes('test')) {
      return {
        text: "To set up an assessment:\n1. Open an existing job posting in the editor (/app/listings)\n2. Click the Assessment step/tab\n3. Add a practical task with a prompt, time limit, and rubric\n4. Or click 'Generate with AI' to auto-create questions from your job description\n5. Save and preview as a candidate before posting",
        actions: [{ type: 'navigate', target: '/app/listings', data: {} }],
      }
    }

    if (lower.includes('job') || lower.includes('posting') || lower.includes('internship')) {
      const { data: jobs } = await sb
        .from('job_listings')
        .select('title, status, location, created_at')
        .eq('company_id', userId)
        .order('created_at', { ascending: false })
        .limit(20)

      if (!jobs || jobs.length === 0) {
        return { text: "You don't have any job postings yet.", actions: [{ type: 'navigate', target: '/app/listings/new', data: {} }] }
      }

      const summary = jobs.slice(0, 8).map((j: any) => `  ${j.title} (${j.status}, ${j.location ?? 'remote-ok'})`).join('\n')
      const more = jobs.length > 8 ? `...and ${jobs.length - 8} more.` : ''
      return { text: `You have ${jobs.length} job posting(s):\n${summary}\n${more}`, actions: [{ type: 'navigate', target: '/app/listings', data: {} }] }
    }

    if (lower.includes('applicant') || lower.includes('application') || lower.includes('candidate')) {
      const { data: apps } = await sb.from('applications').select('id, status').eq('company_id', userId).limit(20)
      const total = apps?.length ?? 0
      const byStatus = (apps ?? []).reduce((acc: Record<string, number>, a: any) => {
        acc[a.status] = (acc[a.status] ?? 0) + 1
        return acc
      }, {})
      const breakdown = Object.entries(byStatus).map(([s, c]) => `${s}: ${c}`).join(', ')
      return { text: `You have ${total} application(s): ${breakdown || 'no breakdown available'}`, actions: [{ type: 'navigate', target: '/app/insights', data: {} }] }
    }

    if (lower.includes('shortlist')) {
      const { data: jobs } = await sb
        .from('job_listings')
        .select('id, title')
        .eq('company_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)

      if (jobs && jobs.length === 1) {
        return {
          text: `Starting Smart Shortlist for "${jobs[0].title}".`,
          actions: [{ type: 'start_shortlist', target: jobs[0].id, data: { job_id: jobs[0].id } }],
        }
      }
      return {
        text: "Navigate to Insights to view your shortlist.",
        actions: [{ type: 'navigate', target: '/app/insights', data: {} }],
      }
    }
  }

  return null
}

/** Dev fallback: generates a fake session ID when Supabase is unreachable. */
function fallbackSession(userId: string, mode: AssistantMode): string {
  return `${userId}_${mode}_${Date.now()}`
}

export async function processAssistantMessage(
  userId: string,
  mode: AssistantMode,
  message: string,
  opts?: { sessionId?: string; pageContext?: string },
): Promise<AssistantResponse> {
  // 1. Session (with DB fallback)
  let sessionId: string
  try {
    sessionId = await resolveSession(userId, mode, opts?.sessionId)
  } catch {
    sessionId = opts?.sessionId ?? fallbackSession(userId, mode)
  }

  // 2. Context (with DB fallback)
  let context: string
  try {
    if (mode === 'student') context = await getStudentContext(userId)
    else if (mode === 'employer') context = await getEmployerContext(userId)
    else context = await getUniversityContext(userId)
  } catch {
    context = `User ${userId} in ${mode} mode (no context available).`
  }

   // 3. Deep-inspect URLs only if the user explicitly asks (e.g. "inspect", "check")
   const urls = extractUrls(message)
   const inspectResults: { url: string; result: any }[] = []
   const wantsInspect = /\binspect\b|\bcheck\b|\bopen\b|\brun\b|\banaylze\b|\bscrape\b/i.test(message)
   if (urls.length && wantsInspect) {
     for (const url of urls.slice(0, 2)) {
       try {
         const result = await deepInspect(url)
         inspectResults.push({ url, result })
       } catch {
         /* non-critical — continue without evidence */
       }
     }
     if (inspectResults.length) {
       context += `\nVERIFIED EVIDENCE (from user-provided URLs):\n${inspectResults
         .map((r) => `URL: ${r.result.url}\nTitle: ${r.result.title}\nSkills: ${(r.result.skills ?? []).join(', ')}\nAchievements: ${(r.result.achievements ?? []).join(', ')}\nSummary: ${r.result.summary}`)
         .join('\n\n')}\n`
     }
   } else if (urls.length && !inspectResults.length) {
     // Note URLs in context so the assistant knows they exist without inspecting
     context += `\nURLS in message (not inspected automatically): ${urls.slice(0, 3).join(', ')}\n`
   }

  // 4. Conversation history (with DB fallback)
  let history: any[] = []
  try {
    history = await fetchHistory(sessionId)
  } catch { /* no history — start fresh */ }
  const historyStr = formatHistory(history)

  // 5. Build prompts
  const system = buildSystemPrompt(mode, context, opts?.pageContext)
  const userMsg = historyStr
    ? `${historyStr}\n\nCURRENT REQUEST:\n${message}`
    : `CURRENT REQUEST:\n${message}`

  // 6. LLM structured output
  let output: AssistantAIOutput | null = null
  if (hasAI()) {
    output = await generateStructured<AssistantAIOutput>({
      system,
      user: userMsg,
      schema: RESPONSE_SCHEMA,
      maxTokens: 1600,
    })
  }

  // 7. Fallback + deterministic action injection
  const actions: AssistantAction[] = []

  if (!output || !output.text?.trim()) {
    // No AI or empty response — try simple intent handler, then generic fallback
    let fallback: { text: string; actions: AssistantAction[] } | null
    try {
      fallback = await fallbackIntentHandler(userId, mode, message)
    } catch {
      fallback = null
    }
    if (fallback) {
      output = { text: fallback.text, actions: fallback.actions }
    } else {
      output = { text: FALLBACK_REPLY, actions: [] }
    }
  } else {
    // Re-run deep inspect results as explicit add_evidence actions (server-side
    // guarantee, not dependent on Claude's output parsing).
    for (const { result } of inspectResults) {
      actions.push({
        type: 'add_evidence',
        target: 'profile_evidence',
        data: {
          source_url: result.url,
          title: result.title,
          status: result.status,
          skills: result.skills,
          achievements: result.achievements,
          summary: result.summary,
        },
      })
    }
  }

  // Merge Claude's actions with any we computed deterministically (dedup by target+type)
  for (const a of output.actions ?? []) {
    const exists = actions.some((x) => x.type === a.type && x.target === a.target)
    if (!exists) actions.push(a)
  }

  // 8. Persist
  await saveMessage(sessionId, 'user', message)
  await saveMessage(sessionId, 'assistant', output.text, actions)

  return {
    text: output.text || FALLBACK_REPLY,
    session_id: sessionId,
    actions,
  }
}

/** One-shot entry point for the employer "Smart Shortlist" demo. */
export async function employerShortlist(jobId: string, employerId: string): Promise<any> {
  const { data: job } = await sb.from('job_listings').select('*').eq('id', jobId).eq('company_id', employerId).maybeSingle()
  if (!job) return null
  const { data: apps } = await sb.from('applications').select('id, student_id, full_name, email, school, year, status, match_score, match_rationale, created_at').eq('job_id', jobId).limit(40)
  if (!apps?.length) return { job_title: job.title, matches: [] }

  const studentIds = [...new Set(apps.map((a) => a.student_id).filter(Boolean))]
  // Fetch evidence summaries in a single batch
  const { data: profiles } = await sb
    .from('profiles')
    .select('id, evidence_summary, skills')
    .in('id', studentIds as string[])
    .limit(40)

  const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]))

  // Sort by match_score (highest first) for ranking
  const sortedApps = [...apps].sort((a: any, b: any) => {
    const sa = a.match_score ?? 0
    const sb = b.match_score ?? 0
    return sb - sa
  })

  const matches = sortedApps.map((app: any, i: number) => {
    const prof = profileMap.get(app.student_id)
    const score = app.match_score ?? Math.max(30, 95 - i * 3)
    return {
      application_id: app.id,
      student_id: app.student_id,
      name: app.full_name || `Candidate ${app.student_id?.slice(0, 8)}`,
      email: app.email || null,
      school: app.school || prof?.school || null,
      year: app.year ?? null,
      status: app.status,
      score: Math.round(score),
      match_rationale: app.match_rationale ?? null,
      evidence_summary: prof?.evidence_summary ?? null,
      skills: prof?.skills ? j.parse<string[]>(prof.skills, []) : [],
      applied_at: app.created_at,
    }
  })

  return { job_title: job.title, job_id: job.id, match_count: matches.length, matches }
}

/** Export the demo matcher for the /assistant/match route. */
export { getFixed40Matches }
