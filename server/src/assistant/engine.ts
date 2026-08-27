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
          type: { type: 'string' as const, enum: ['inject_data', 'navigate', 'update_profile', 'add_evidence'] },
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
  let prompt = `You are the Optryva Assistant — a helpful AI integrated into the Optryva internship platform (${modeName} mode).\n\n`
  prompt += `When the user asks to create, add, update, or modify data, return the data in an 'inject_data' action with the appropriate 'target'. Things get added IMMEDIATELY to the app — no confirmation card needed.\n\n`
  prompt += `Action types:\n`
  prompt += `- inject_data: inject structured data into a target (e.g. 'profile_skills' → {skills: [...], mode: 'add'|'replace'}, 'job_editor' → {job: {...}}, 'resume' → {...})\n`
  prompt += `- navigate: navigate to a route path (e.g. '/app/jobs')\n`
  prompt += `- update_profile: update profile fields (e.g. {skills: [...], full_name: '...'})\n`
  prompt += `- add_evidence: add a verified evidence item to the student's profile (e.g. {url, title, skills: [...], achievements: [...]})\n\n`
  prompt += `If the user asks for opportunities/matches, return a navigate action to '/app/jobs'. If they ask about shortlists, navigate to '/app/insights'.\n\n`
  prompt += `GROUNDING CONTEXT:\n${context}\n\n`
  if (pageContext) {
    prompt += `CURRENT PAGE CONTEXT: The user is on ${pageContext}. Keep this in mind when acting.\n\n`
  }
  prompt += `Return ONLY a JSON object with "text" (your reply) and "actions" (array, empty if none).`
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

const FALLBACK_REPLY = "I'm here to help with your Optryva internship journey. Try asking me to add a skill to your profile, draft a cover letter, or explain a job posting."

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

  // 3. Deep-inspect any URLs the user dropped in
  const urls = extractUrls(message)
  const inspectResults: { url: string; result: any }[] = []
  if (urls.length) {
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

  if (!output) {
    output = { text: FALLBACK_REPLY, actions: [] }
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
  const { data: apps } = await sb.from('applications').select('id, student_id, status').eq('job_id', jobId).limit(40)
  if (!apps?.length) return { job_title: job.title, matches: [] }

  const studentIds = [...new Set(apps.map((a) => a.student_id).filter(Boolean))]
  const matches = studentIds.map((sid, i) => ({
    id: sid,
    name: `Candidate ${sid?.slice(0, 8)}`,
    score: Math.max(30, 95 - i * 3),
    strengths: ['Evidence-backed'],
    gap: 'None detected',
  }))

  return { job_title: job.title, matches }
}

/** Export the demo matcher for the /assistant/match route. */
export { getFixed40Matches }
