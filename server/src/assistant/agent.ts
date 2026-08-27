/**
 * Agentic Workflow Engine — lets the AI assistant *execute* multi-step tasks
 * autonomously rather than just returning a single response + actions.
 *
 * Uses the LLM abstraction layer (./llm) — Mistral primary, Claude fallback.
 * Since Mistral (and Claude's non-streaming path) don't have native tool
 * calling in this setup, we use JSON-mode tool calling: Claude is instructed
 * to return a JSON object with `text` and `tool_calls`, and the engine parses
 * the tool calls, executes them, and feeds results back as conversation turns.
 *
 * The engine returns an async generator yielding SSE-friendly event objects so
 * the route can stream progress + tool results to the client.
 *
 * To switch providers: change ONLY llm.ts.
 */
import { generateTurn, hasAI, model as modelName, getProvider, Provider } from './llm'
import { sb, must, j } from '@/db'
import { deepInspect, getFixed40Matches } from './tools'
import { getStudentContext, getEmployerContext, getUniversityContext } from './context'
import type { AssistantMode, AssistantAction } from './types'

/** Event yielded by the agent — the route converts each into an SSE frame. */
export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'action'; action: AssistantAction }
  | { type: 'tool_use'; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: string }
  | { type: 'done'; summary: string }
  | { type: 'error'; message: string }
  | { type: 'end' }

type ToolInput = Record<string, unknown>

/** Validate an emit_action input against the action schema and allowlist. */
const ALLOWED_NAV_TARGETS = new Set([
  '/app/jobs', '/app/listings', '/app/listings/new', '/app/applications',
  '/app/insights', '/app/profile', '/app/jobs/new', '/app/dashboard', '/app/applicants',
])

function parseAction(input: ToolInput): AssistantAction | null {
  if (!input || typeof input !== 'object') return null
  const type = input.type
  const target = input.target
  const data = input.data
  if (typeof type !== 'string' || typeof target !== 'string') return null
  const validTypes: AssistantAction['type'][] = ['inject_data', 'navigate', 'update_profile', 'add_evidence', 'create_job', 'start_shortlist']
  if (!validTypes.includes(type as AssistantAction['type'])) return null
  // Validate navigation targets are within the allowlist
  if (type === 'navigate' && !ALLOWED_NAV_TARGETS.has(target)) return null
  return { type: type as AssistantAction['type'], target, data: (data ?? {}) as Record<string, unknown> }
}

/** Helper: read a parameter trying multiple name variants (Mistral may use
 *  slightly different names than the schema declares). */
function getParam(input: ToolInput, ...names: string[]): unknown {
  for (const n of names) if (n in input && input[n] !== undefined) return input[n]
  return undefined
}
function getStr(input: ToolInput, ...names: string[]): string | undefined {
  const v = getParam(input, ...names)
  return typeof v === 'string' ? v : undefined
}
function getStrArray(input: ToolInput, ...names: string[]): string[] | undefined {
  const v = getParam(input, ...names)
  if (Array.isArray(v)) return v as string[]
  if (typeof v === 'string') try { return JSON.parse(v) as string[] } catch { return undefined }
  return undefined
}

/** Agent's structured output schema — text + tool_calls. */
const AGENT_SCHEMA = {
  type: 'object' as const,
  properties: {
    text: { type: 'string' as const, description: 'Your thinking + final reply to the user.' },
    tool_calls: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const, description: 'The tool name to call.' },
          input: {
            type: 'object' as const,
            description: 'The arguments for the tool call.',
            additionalProperties: true,
          },
        },
        required: ['name', 'input'],
      },
    },
  },
  required: ['text', 'tool_calls'],
  additionalProperties: false,
}

/** Tool descriptions for the system prompt (Claude/Anthropic mode fallback). */
const TOOL_DESCRIPTIONS = `Available tools and their EXACT parameter names:

1. deep_inspect(url: string) — Open and analyze an external URL (GitHub, portfolio, etc.). Extracts skills and achievements.

2. update_profile_skills(skills: string[], mode: "add"|"replace") — Add or replace skills on the current user's profile. Use mode="add" to append, mode="replace" to overwrite the entire list.

3. create_job_draft(title: string, description?: string, location?: string, listing_type?: string, tags?: string[], qualifications?: string[], responsibilities?: string[], benefits?: string[], pay?: string) — Create a draft job/internship posting for an employer. Only call this in employer mode.

4. get_fixed40_matches(student_id: string) — Return 40 demo internship matches for a student. DEMO ONLY.

  5. get_employer_shortlist(job_id: string) — Get ranked candidates for a posted job. Returns match scores.

  6. list_employer_jobs — List all job postings for the employer (no args).

  7. get_job_candidates(job_id: string) — List all candidates for a job with statuses, match scores, and evidence summaries.

  8. get_candidate_evidence(student_id: string) — Get AI evidence summary + list of evidence items for a candidate.

  9. shortlist_candidate(application_id: string) — Mark a candidate as shortlisted.

  10. reject_candidate(application_id: string) — Reject a candidate application.

  11. emit_action(type: "inject_data"|"navigate"|"update_profile"|"add_evidence"|"create_job"|"start_shortlist", target: string, data: object) — Emit a client-side action. For start_shortlist: target = job_id, data = { job_id: string }.

  12. save_message(session_id: string, role: string, content: string) — Persist a message to conversation history for audit.
`

type TurnMessage = { role: 'user' | 'assistant'; content: string }

/* --------------------------- Tool Implementations --------------------------- */

const TOOL_EXECUTORS: Record<string, (input: ToolInput, userId: string, mode: AssistantMode) => Promise<string>> = {
  deep_inspect: async (input) => {
    const url = getStr(input, 'url')
    if (!url) return JSON.stringify({ error: 'url is required' })
    const result = await deepInspect(url)
    return JSON.stringify(result)
  },
  update_profile_skills: async (input, userId) => {
    const skills = getStrArray(input, 'skills', 'skills_to_add', 'add_skills') ?? []
    const mode = (getStr(input, 'mode', 'action') as 'add' | 'replace') ?? 'replace'
    const { data: profile } = await sb.from('profiles').select('skills').eq('id', userId).maybeSingle()
    const current = j.parse<string[]>(profile?.skills, [])
    const updated = mode === 'add' ? Array.from(new Set([...current, ...skills])) : skills
    const { error } = await sb.from('profiles').update({ skills: JSON.stringify(updated) }).eq('id', userId)
    if (error) return JSON.stringify({ error: error.message })
    return JSON.stringify({ skills: updated, count: updated.length, mode })
  },
  get_fixed40_matches: async (input) => {
    const studentId = getStr(input, 'student_id', 'id')
    if (!studentId) return JSON.stringify({ error: 'student_id is required' })
    const matches = await getFixed40Matches(studentId)
    return JSON.stringify({ count: matches.length, matches })
  },
  create_job_draft: async (input, userId, mode) => {
    if (mode !== 'employer') {
      return JSON.stringify({ error: 'create_job_draft requires employer mode' })
    }
    const title = getStr(input, 'title')
    if (!title) return JSON.stringify({ error: 'title is required' })
    const { data: job, error } = await sb
      .from('job_listings')
      .insert({
        company_id: userId,
        title,
        description: getStr(input, 'description', 'desc') ?? '',
        location: getStr(input, 'location', 'city'),
        listing_type: getStr(input, 'listing_type', 'type') ?? 'Internship',
        type: getStr(input, 'listing_type', 'type') ?? 'Internship',
        tags: j.stringify(getStrArray(input, 'tags') ?? []),
        qualifications: j.stringify(getStrArray(input, 'qualifications', 'requirements') ?? []),
        responsibilities: j.stringify(getStrArray(input, 'responsibilities') ?? []),
        benefits: j.stringify(getStrArray(input, 'benefits') ?? []),
        pay: getStr(input, 'pay', 'stipend') ?? '',
        status: 'draft',
      })
      .select('id, title, status')
      .single()
    if (error) return JSON.stringify({ error: error.message })
    return JSON.stringify({ job_id: job.id, title: job.title, status: job.status })
  },
  get_employer_shortlist: async (input, userId) => {
    const { employerShortlist } = await import('./engine')
    const jobId = getStr(input, 'job_id', 'id')
    if (!jobId) return JSON.stringify({ error: 'job_id is required' })
    const result = await employerShortlist(jobId, userId)
    if (!result) return JSON.stringify({ error: 'not_found' })
    return JSON.stringify(result)
  },
  list_employer_jobs: async (_input, userId) => {
    const { data: jobs, error } = await sb
      .from('job_listings')
      .select('id,title,description,type,location,pay,status,created_at,tags')
      .eq('company_id', userId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) return JSON.stringify({ error: error.message })
    return JSON.stringify({ count: jobs?.length ?? 0, jobs: jobs ?? [] })
  },
  get_job_candidates: async (input, userId) => {
    const jobId = getStr(input, 'job_id', 'id')
    if (!jobId) return JSON.stringify({ error: 'job_id is required' })
    const { data: apps, error } = await sb
      .from('applications')
      .select('id,student_id,full_name,email,school,year,status,match_score,match_rationale,created_at')
      .eq('job_id', jobId)
      .limit(40)
    if (error) return JSON.stringify({ error: error.message })
    const candidates = (apps ?? []).map((a: any) => ({
      id: a.id,
      student_id: a.student_id,
      name: a.full_name,
      email: a.email,
      school: a.school,
      year: a.year,
      status: a.status,
      match_score: a.match_score,
      match_rationale: a.match_rationale,
      applied_at: a.created_at,
    }))
    return JSON.stringify({ count: candidates.length, candidates })
  },
  get_candidate_evidence: async (input) => {
    const studentId = getStr(input, 'student_id', 'id')
    if (!studentId) return JSON.stringify({ error: 'student_id is required' })
    const { data: profile } = await sb
      .from('profiles')
      .select('evidence_summary, full_name, school, major, year')
      .eq('id', studentId)
      .maybeSingle()
    const { data: items, error: itemsErr } = await sb
      .from('evidence_items')
      .select('id,title,type,created_at')
      .eq('student_id', studentId)
      .limit(20)
    return JSON.stringify({
      candidate_name: profile?.full_name ?? 'Unknown',
      school: profile?.school ?? null,
      major: profile?.major ?? null,
      year: profile?.year ?? null,
      evidence_summary: profile?.evidence_summary ?? 'No evidence submitted yet.',
      evidence_count: items?.length ?? 0,
      evidence: itemsErr ? [] : items ?? [],
    })
  },
  shortlist_candidate: async (input) => {
    const appId = getStr(input, 'application_id', 'app_id', 'id')
    if (!appId) return JSON.stringify({ error: 'application_id is required' })
    const { error } = await sb
      .from('applications')
      .update({ status: 'shortlisted' })
      .eq('id', appId)
    if (error) return JSON.stringify({ error: error.message })
    return JSON.stringify({ ok: true, application_id: appId, new_status: 'shortlisted' })
  },
  reject_candidate: async (input) => {
    const appId = getStr(input, 'application_id', 'app_id', 'id')
    if (!appId) return JSON.stringify({ error: 'application_id is required' })
    const { error } = await sb
      .from('applications')
      .update({ status: 'rejected' })
      .eq('id', appId)
    if (error) return JSON.stringify({ error: error.message })
    return JSON.stringify({ ok: true, application_id: appId, new_status: 'rejected' })
  },
  emit_action: async (input) => {
    const action = parseAction(input)
    if (!action) return JSON.stringify({ error: 'invalid_action' })
    return JSON.stringify({ emitted: true, type: action.type, target: action.target })
  },
  save_message: async (input) => {
    try {
      await sb.from('assistant_messages').insert({
        session_id: input.session_id,
        role: input.role,
        content: input.content,
      })
    } catch { /* non-critical */ }
    return JSON.stringify({ saved: true })
  },
}

/* --------------------------- Helper --------------------------- */

/** Race a promise against a timeout. */
function withTimeout<T>(p: Promise<T> | PromiseLike<T>, ms: number, label = 'operation'): Promise<T> {
  const realP = Promise.resolve(p)
  return Promise.race([
    realP,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ])
}

async function resolveSession(userId: string, mode: AssistantMode, sessionId?: string): Promise<string> {
  if (sessionId) {
    const r = must(await sb.from('assistant_sessions').select('id').eq('id', sessionId).eq('user_id', userId).maybeSingle()) as { id: string } | null
    if (r) return r.id
  }
  const res = await sb.from('assistant_sessions').insert({ user_id: userId, mode }).select('id').single()
  return (must(res) as { id: string }).id
}

function inferMode(user: { user_type: string }): AssistantMode {
  switch (user.user_type) {
    case 'school':
      return 'university'
    case 'company':
      return 'employer'
    default:
      return 'student'
  }
}

/* --------------------------- Agent Loop --------------------------- */

const SYSTEM_PROMPT =
  `You are the Optryva Assistant — a concise AI that executes exactly what the user asks. ` +
  `Keep text replies to 1-2 sentences. No markdown. The current user is in {MODE} mode ` +
  `({MODE_DESC}). Only use tools appropriate for this role. ` +
  `Call only the tools needed to complete the request. ` +
  `After calling tools, if the task is complete, return tool_calls: [].\n\n` +
  `${TOOL_DESCRIPTIONS}\n\n` +
  `Return ONLY valid JSON: {"text":"brief reply","tool_calls":[...]}. ` +
  `If done, return tool_calls: [].`;

/**
 * Run the agentic loop. Yields events for streaming to the client.
 */
export async function* runAgent(
  userId: string,
  mode: AssistantMode,
  message: string,
  opts?: { sessionId?: string; pageContext?: string },
): AsyncGenerator<AgentEvent> {
   if (!hasAI()) {
     yield { type: 'text', text: "I'm not configured right now. Please try again later." }
     yield { type: 'done', summary: 'No AI provider configured.' }
     return
   }

   const maxIters = 3
   const MAX_TOOL_CALLS = 3
   const AI_TIMEOUT_MS = 8000
   const TOOL_TIMEOUT_MS = 8000
   const SB_TIMEOUT_MS = 5000

   // 0. Resolve session (with fallback when Supabase is unavailable)
   let sessionId: string
   try {
     sessionId = await withTimeout(resolveSession(userId, mode, opts?.sessionId), SB_TIMEOUT_MS, 'session_resolve')
   } catch {
     sessionId = opts?.sessionId ?? `${userId}_${mode}_${Date.now()}`
   }

   // 1. Gather context (with fallback)
   let context: string
   try {
     let ctxPromise: Promise<string>
     if (mode === 'student') ctxPromise = getStudentContext(userId)
     else if (mode === 'employer') ctxPromise = getEmployerContext(userId)
     else ctxPromise = getUniversityContext(userId)
     context = await withTimeout(ctxPromise, SB_TIMEOUT_MS, 'context_fetch')
   } catch {
     context = `User ${userId} in ${mode} mode (no Supabase context available).`
   }

  // 2. Build conversation
  const turnMessages: TurnMessage[] = [
    {
      role: 'user',
      content: `CONTEXT (${mode} mode):\n${context}\n\n${opts?.pageContext ? `CURRENT PAGE: ${opts.pageContext}\n\n` : ''}CURRENT REQUEST:\n${message}`,
    },
  ]

   // 2b. Persist the user's message (best-effort)
   try {
     await withTimeout(
       sb.from('assistant_messages').insert({
         session_id: sessionId,
         role: 'user',
         content: message,
       }),
       SB_TIMEOUT_MS,
       'persist_user_msg',
     )
   } catch { /* non-critical */ }

  // 3. Agent loop
   const modeDesc: Record<AssistantMode, string> = {
     student: 'a student looking for internships',
     employer: 'an employer posting jobs and reviewing candidates',
     university: 'a university career office',
   }

   for (let iter = 0; iter < maxIters; iter++) {
      const parsed = await withTimeout(
        generateTurn<{ text: string; tool_calls: { name: string; input: ToolInput }[] }>({
          system: SYSTEM_PROMPT.replace('{MODE}', mode).replace('{MODE_DESC}', modeDesc[mode]),
          messages: turnMessages,
          schema: AGENT_SCHEMA,
          maxTokens: 1000,
        }),
        AI_TIMEOUT_MS,
        'generateTurn',
      )

    if (!parsed) {
      yield { type: 'error', message: 'The AI provider returned an empty response.' }
      yield { type: 'done', summary: 'Error: no response from AI provider.' }
      return
    }

    // Emit text
    if (parsed.text) {
      yield { type: 'text', text: parsed.text }
    }

     // Process tool calls — limit to MAX_TOOL_CALLS
     const toolCalls = (parsed.tool_calls ?? []).slice(0, MAX_TOOL_CALLS)
     if (toolCalls.length === 0) {
      // Agent is done — persist its final text
      if (parsed.text) {
        await withTimeout(
          sb.from('assistant_messages').insert({
            session_id: sessionId,
            role: 'assistant',
            content: parsed.text,
          }),
          SB_TIMEOUT_MS,
          'persist_assistant_msg',
        )
      }
      yield { type: 'done', summary: parsed.text || 'Done!' }
      break
    }

     // Assistant's turn (text + tool_calls)
     const assistantContent = JSON.stringify({ text: parsed.text, tool_calls: parsed.tool_calls })
     turnMessages.push({ role: 'assistant', content: assistantContent })

     // Announce all tool calls first
     for (const tc of toolCalls) {
       yield { type: 'tool_use', name: tc.name, input: tc.input }
     }

     // Execute tools in parallel (bounded by Promise.all — max MAX_TOOL_CALLS)
     const toolResults = await Promise.all(
       toolCalls.map(async (tc) => {
         const executor = TOOL_EXECUTORS[tc.name]
         let result: string
         let action: AssistantAction | null = null
         try {
           if (executor) {
             result = await withTimeout(executor(tc.input, userId, mode), TOOL_TIMEOUT_MS, tc.name)
           } else {
             result = JSON.stringify({ error: `Unknown tool: ${tc.name}` })
           }
         } catch (e: any) {
           result = JSON.stringify({ error: e?.message ?? 'tool_execution_failed' })
         }
         if (tc.name === 'emit_action') {
           action = parseAction(tc.input)
         }
         return { tc, result, action }
       }),
     )

     // Yield results, actions, and feed back into conversation
     for (const { tc, result, action } of toolResults) {
       yield { type: 'tool_result', name: tc.name, result }
       if (action) yield { type: 'action', action }
       turnMessages.push({
         role: 'user',
         content: `Tool "${tc.name}" returned:\n${result}`,
       })
     }

    }

  yield { type: 'end' }
}

// Re-export for the route
export { inferMode, resolveSession }
