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

  13. count_applicants(job_id?: string) — Count total applicants across all employer jobs, or for a specific job_id if provided. Returns total count, per-job breakdown, and per-candidate score/evidence summary.

  14. delete_job(job_id: string, confirm?: boolean) — Delete a job listing (and its applications). Requires explicit confirmation via confirm=true. Only callable in employer mode.
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
    console.log('[assistant:agent:tool] update_profile_skills', { userId, skills, mode })
    try {
    const { data: profile, error: profErr } = await sb.from('profiles').select('skills').eq('id', userId).maybeSingle()
    if (profErr) { console.error('[assistant:agent:tool] ✗ Supabase error fetching profile skills:', profErr.message); return JSON.stringify({ error: profErr.message }) }
    const current = j.parse<string[]>(profile?.skills, [])
    const updated = mode === 'add' ? Array.from(new Set([...current, ...skills])) : skills
    const { error } = await sb.from('profiles').update({ skills: JSON.stringify(updated) }).eq('id', userId)
    if (error) { console.error('[assistant:agent:tool] ✗ Supabase error updating skills:', error.message); return JSON.stringify({ error: error.message }) }
    console.log('[assistant:agent:tool] ✓ skills updated:', { count: updated.length, mode })
    return JSON.stringify({ skills: updated, count: updated.length, mode })
    } catch (e: any) { console.error('[assistant:agent:tool] ✗ update_profile_skills error:', e?.message); return JSON.stringify({ error: e?.message ?? 'tool_execution_failed' }) }
  },
  get_fixed40_matches: async (input) => {
    const studentId = getStr(input, 'student_id', 'id')
    if (!studentId) return JSON.stringify({ error: 'student_id is required' })
    const matches = await getFixed40Matches(studentId)
    return JSON.stringify({ count: matches.length, matches })
  },
  create_job_draft: async (input, userId, mode) => {
    if (mode !== 'employer') {
      console.warn('[assistant:agent:tool] create_job_draft called in non-employer mode:', mode)
      return JSON.stringify({ error: 'create_job_draft requires employer mode' })
    }
    const title = getStr(input, 'title')
    console.log('[assistant:agent:tool] create_job_draft', { userId, title, location: getStr(input, 'location'), listing_type: getStr(input, 'listing_type') })
    if (!title) return JSON.stringify({ error: 'title is required' })
    try {
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
    if (error) {
      console.error('[assistant:agent:tool] ✗ Supabase error creating job draft:', error.message)
      return JSON.stringify({ error: error.message })
    }
    console.log('[assistant:agent:tool] ✓ job draft created:', { job_id: job.id, title: job.title, status: job.status, userId })
    return JSON.stringify({ job_id: job.id, title: job.title, status: job.status })
    } catch (e: any) {
      console.error('[assistant:agent:tool] ✗ create_job_draft error:', { message: e?.message, stack: e?.stack?.split('\n').slice(0, 3) })
      return JSON.stringify({ error: e?.message ?? 'tool_execution_failed' })
    }
  },
  get_employer_shortlist: async (input, userId) => {
    const { employerShortlist } = await import('./engine')
    const jobId = getStr(input, 'job_id', 'id')
    console.log('[assistant:agent:tool] get_employer_shortlist', { userId, jobId })
    if (!jobId) return JSON.stringify({ error: 'job_id is required' })
    try {
      const result = await employerShortlist(jobId, userId)
      if (!result) {
        console.warn('[assistant:agent:tool] ✗ shortlist returned null/not found:', { jobId, userId })
        return JSON.stringify({ error: 'not_found' })
      }
      console.log('[assistant:agent:tool] ✓ shortlist returned:', { jobId, match_count: result.match_count, user_id: result.user_id })
      return JSON.stringify(result)
    } catch (e: any) {
      console.error('[assistant:agent:tool] ✗ get_employer_shortlist error:', { message: e?.message, stack: e?.stack?.split('\n').slice(0, 3) })
      return JSON.stringify({ error: e?.message ?? 'tool_execution_failed' })
    }
  },
  list_employer_jobs: async (_input, userId) => {
    console.log('[assistant:agent:tool] list_employer_jobs', { userId })
    try {
    const { data: jobs, error } = await sb
      .from('job_listings')
      .select('id,title,description,type,location,pay,status,created_at,tags')
      .eq('company_id', userId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) {
      console.error('[assistant:agent:tool] ✗ Supabase error listing jobs:', error.message)
      return JSON.stringify({ error: error.message })
    }
    console.log('[assistant:agent:tool] ✓ jobs listed:', { count: jobs?.length ?? 0, userId })
    return JSON.stringify({ count: jobs?.length ?? 0, jobs: jobs ?? [] })
    } catch (e: any) {
      console.error('[assistant:agent:tool] ✗ list_employer_jobs error:', e?.message)
      return JSON.stringify({ error: e?.message ?? 'tool_execution_failed' })
    }
  },
  get_job_candidates: async (input, userId) => {
    const jobId = getStr(input, 'job_id', 'id')
    console.log('[assistant:agent:tool] get_job_candidates', { userId, jobId })
    if (!jobId) return JSON.stringify({ error: 'job_id is required' })
    try {
    const { data: apps, error } = await sb
      .from('applications')
      .select('id,student_id,full_name,email,school,year,status,match_score,match_rationale,created_at')
      .eq('job_id', jobId)
      .limit(40)
    if (error) {
      console.error('[assistant:agent:tool] ✗ Supabase error fetching candidates:', error.message)
      return JSON.stringify({ error: error.message })
    }
    console.log('[assistant:agent:tool] ✓ candidates fetched:', { jobId, count: apps?.length ?? 0 })
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
    } catch (e: any) {
      console.error('[assistant:agent:tool] ✗ get_job_candidates error:', e?.message)
      return JSON.stringify({ error: e?.message ?? 'tool_execution_failed' })
    }
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
    console.log('[assistant:agent:tool] shortlist_candidate', { appId })
    if (!appId) return JSON.stringify({ error: 'application_id is required' })
    try {
    const { error } = await sb
      .from('applications')
      .update({ status: 'shortlisted' })
      .eq('id', appId)
    if (error) {
      console.error('[assistant:agent:tool] ✗ Supabase error shortlisting:', error.message)
      return JSON.stringify({ error: error.message })
    }
    console.log('[assistant:agent:tool] ✓ candidate shortlisted:', { appId })
    return JSON.stringify({ ok: true, application_id: appId, new_status: 'shortlisted' })
    } catch (e: any) {
      console.error('[assistant:agent:tool] ✗ shortlist_candidate error:', e?.message)
      return JSON.stringify({ error: e?.message ?? 'tool_execution_failed' })
    }
  },
  reject_candidate: async (input) => {
    const appId = getStr(input, 'application_id', 'app_id', 'id')
    console.log('[assistant:agent:tool] reject_candidate', { appId })
    if (!appId) return JSON.stringify({ error: 'application_id is required' })
    try {
    const { error } = await sb
      .from('applications')
      .update({ status: 'rejected' })
      .eq('id', appId)
    if (error) {
      console.error('[assistant:agent:tool] ✗ Supabase error rejecting:', error.message)
      return JSON.stringify({ error: error.message })
    }
    console.log('[assistant:agent:tool] ✓ candidate rejected:', { appId })
    return JSON.stringify({ ok: true, application_id: appId, new_status: 'rejected' })
    } catch (e: any) {
      console.error('[assistant:agent:tool] ✗ reject_candidate error:', e?.message)
      return JSON.stringify({ error: e?.message ?? 'tool_execution_failed' })
    }
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
  count_applicants: async (input, userId) => {
    const jobId = getStr(input, 'job_id', 'id')
    console.log('[assistant:agent:tool] count_applicants', { userId, jobId: jobId ?? 'all' })
    try {
      const jobIds: string[] = []
      if (jobId) {
        const { data: job } = await sb.from('job_listings').select('id').eq('id', jobId).eq('company_id', userId).maybeSingle()
        if (!job) {
          console.warn('[assistant:agent:tool] count_applicants — job not found or access denied:', { jobId, userId })
          return JSON.stringify({ error: 'job_not_found' })
        }
        jobIds.push(job.id)
      } else {
        const { data: jobs } = await sb.from('job_listings').select('id').eq('company_id', userId)
        jobs?.forEach((j: any) => jobIds.push(j.id))
      }
      console.log('[assistant:agent:tool] count_applicants — jobs:', { count: jobIds.length, jobIds: jobIds.slice(0, 20) })

      let apps: any[] = []
      if (jobIds.length) {
        const { data: fetched, error } = await sb
          .from('applications')
          .select('id, student_id, full_name, email, school, year, status, match_score, assignment_score, assignment_status, created_at, job_id')
          .in('job_id', jobIds)
          .order('created_at', { ascending: false })
          .limit(100)
        if (error) {
          console.error('[assistant:agent:tool] ✗ Supabase error querying applications:', error.message)
          return JSON.stringify({ error: error.message })
        }
        apps = fetched ?? []
      }
      console.log('[assistant:agent:tool] ✓ applications fetched:', { count: apps.length })

      const { data: profiles } = await sb
        .from('profiles')
        .select('id, full_name, evidence_summary')
        .in('id', [...new Set(apps.map((a: any) => a.student_id).filter(Boolean))] as string[])

      const pmap = new Map((profiles ?? []).map((p: any) => [p.id, p]))

      const byJob: Record<string, number> = {}
      const byStatus: Record<string, number> = {}
      const candidates: any[] = []

      for (const a of apps) {
        byJob[a.job_id] = (byJob[a.job_id] ?? 0) + 1
        byStatus[a.status] = (byStatus[a.status] ?? 0) + 1
        candidates.push({
          application_id: a.id,
          student_id: a.student_id,
          name: a.full_name || pmap.get(a.student_id)?.full_name || 'candidate',
          email: a.email,
          school: a.school,
          year: a.year,
          job_id: a.job_id,
          status: a.status,
          match_score: a.match_score,
          assignment_score: a.assignment_score,
          assignment_status: a.assignment_status,
          evidence_summary: pmap.get(a.student_id)?.evidence_summary ?? null,
          applied_at: a.created_at,
        })
      }

      console.log('[assistant:agent:tool] count_applicants COMPLETE:', {
        total: apps.length, status_breakdown: byStatus, job_breakdown_count: Object.keys(byJob).length,
      })
      return JSON.stringify({
        total: apps.length,
        status_breakdown: byStatus,
        per_job: byJob,
        candidates: candidates.slice(0, 30),
      })
    } catch (e: any) {
      console.error('[assistant:agent:tool] ✗ count_applicants error:', e?.message)
      return JSON.stringify({ error: e?.message ?? 'tool_execution_failed' })
    }
  },
  delete_job: async (input, userId, mode) => {
    const jobId = getStr(input, 'job_id', 'id')
    const confirmed = getParam(input, 'confirm', 'confirmed') === true
    console.log('[assistant:agent:tool] delete_job', { userId, jobId, confirmed, mode })
    if (mode !== 'employer') {
      return JSON.stringify({ error: 'delete_job requires employer mode' })
    }
    if (!jobId) return JSON.stringify({ error: 'job_id is required' })
    if (!confirmed) {
      return JSON.stringify({ error: 'confirmation_required', message: 'Pass confirm=true to delete this job listing and all its applications.' })
    }
    try {
      // Verify ownership
      const { data: job, error: jobErr } = await sb.from('job_listings').select('id, title').eq('id', jobId).eq('company_id', userId).maybeSingle()
      if (jobErr || !job) {
        console.warn('[assistant:agent:tool] ✗ job not found or access denied:', { jobId, userId })
        return JSON.stringify({ error: 'not_found' })
      }
      // Delete the job (applications cascade or can be cleaned up)
      const { error: delErr } = await sb.from('job_listings').delete().eq('id', jobId)
      if (delErr) {
        console.error('[assistant:agent:tool] ✗ Supabase error deleting job:', delErr.message)
        return JSON.stringify({ error: delErr.message })
      }
      console.log('[assistant:agent:tool] ✓ job deleted:', { jobId, userId })
      return JSON.stringify({ ok: true, job_id: jobId, job_title: job.title })
    } catch (e: any) {
      console.error('[assistant:agent:tool] ✗ delete_job error:', e?.message)
      return JSON.stringify({ error: e?.message ?? 'tool_execution_failed' })
    }
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
     console.error('[assistant:agent] ✗ no AI provider configured — aborting')
     yield { type: 'text', text: "I'm not configured right now. Please try again later." }
     yield { type: 'done', summary: 'No AI provider configured.' }
     return
   }

   console.log('[assistant:agent] ── runAgent START ──', {
     userId, mode, sessionId: opts?.sessionId ?? 'none',
     pageContext: opts?.pageContext ?? 'none',
     message_preview: message.slice(0, 200),
   })

   const maxIters = 3
   const MAX_TOOL_CALLS = 3
   const AI_TIMEOUT_MS = 8000
   const TOOL_TIMEOUT_MS = 8000
   const SB_TIMEOUT_MS = 5000

   // 0. Resolve session (with fallback when Supabase is unavailable)
   let sessionId: string
   try {
     sessionId = await withTimeout(resolveSession(userId, mode, opts?.sessionId), SB_TIMEOUT_MS, 'session_resolve')
     console.log('[assistant:agent] ✓ session resolved:', sessionId)
   } catch (e: any) {
     console.warn('[assistant:agent] ⚠ session resolve failed, using fallback:', e?.message)
     sessionId = opts?.sessionId ?? `${userId}_${mode}_${Date.now()}`
   }

   // 1. Gather context (with fallback)
   let context: string
   try {
     console.log('[assistant:agent] fetching context for mode:', mode)
     let ctxPromise: Promise<string>
     if (mode === 'student') ctxPromise = getStudentContext(userId)
     else if (mode === 'employer') ctxPromise = getEmployerContext(userId)
     else ctxPromise = getUniversityContext(userId)
     context = await withTimeout(ctxPromise, SB_TIMEOUT_MS, 'context_fetch')
     console.log('[assistant:agent] ✓ context built', { ctx_len: context.length })
   } catch (e: any) {
     console.warn('[assistant:agent] ⚠ context fetch failed:', e?.message)
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
      console.log(`[assistant:agent] ── loop iter ${iter + 1}/${maxIters} ──`)
      let parsed: { text: string; tool_calls: { name: string; input: ToolInput }[] } | null = null
      try {
        parsed = await withTimeout(
          generateTurn<{ text: string; tool_calls: { name: string; input: ToolInput }[] }>({
            system: SYSTEM_PROMPT.replace('{MODE}', mode).replace('{MODE_DESC}', modeDesc[mode]),
            messages: turnMessages,
            schema: AGENT_SCHEMA,
            maxTokens: 1000,
          }),
          AI_TIMEOUT_MS,
          'generateTurn',
        )
      } catch (e: any) {
        console.error('[assistant:agent] ✗ generateTurn error or timeout on iter %d:', iter, { message: e?.message, stack: e?.stack?.split('\n').slice(0, 3) })
        yield { type: 'error', message: e?.message ?? 'AI call failed or timed out' }
        yield { type: 'done', summary: 'Error: AI call failed.' }
        return
      }

      if (!parsed) {
        console.warn('[assistant:agent] ⚠ AI returned null/empty on iter %d', iter)
        yield { type: 'error', message: 'The AI provider returned an empty response.' }
        yield { type: 'done', summary: 'Error: no response from AI provider.' }
        return
      }

      console.log('[assistant:agent] ✓ AI response parsed:', {
        text_preview: (parsed.text || '').slice(0, 150),
        tool_call_count: parsed.tool_calls?.length ?? 0,
        tool_names: parsed.tool_calls?.map(tc => tc.name),
      })

      // Emit text
      if (parsed.text) {
        yield { type: 'text', text: parsed.text }
      }

      // Process tool calls — limit to MAX_TOOL_CALLS
      const toolCalls = (parsed.tool_calls ?? []).slice(0, MAX_TOOL_CALLS)
      if (toolCalls.length === 0) {
        console.log('[assistant:agent] ✓ agent done — no more tool calls')
        // Agent is done — persist its final text
        if (parsed.text) {
          try {
            await withTimeout(
              sb.from('assistant_messages').insert({
                session_id: sessionId,
                role: 'assistant',
                content: parsed.text,
              }),
              SB_TIMEOUT_MS,
              'persist_assistant_msg',
            )
            console.log('[assistant:agent] ✓ final assistant message persisted')
          } catch (e: any) {
            console.error('[assistant:agent] ✗ error persisting assistant message:', e?.message)
          }
        }
        yield { type: 'done', summary: parsed.text || 'Done!' }
        break
      }

      console.log('[assistant:agent] processing %d tool call(s):', toolCalls.length, toolCalls.map(tc => tc.name))

      // Assistant's turn (text + tool_calls)
      const assistantContent = JSON.stringify({ text: parsed.text, tool_calls: parsed.tool_calls })
      turnMessages.push({ role: 'assistant', content: assistantContent })

      // Announce all tool calls first
      for (const tc of toolCalls) {
        console.log('[assistant:agent] → tool_use:', tc.name, JSON.stringify(tc.input).slice(0, 200))
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
              console.log('[assistant:agent] ⏳ executing tool:', tc.name)
              result = await withTimeout(executor(tc.input, userId, mode), TOOL_TIMEOUT_MS, tc.name)
              console.log('[assistant:agent] ✓ tool %s returned:', tc.name, result.slice(0, 200))
            } else {
              console.error('[assistant:agent] ✗ unknown tool:', tc.name)
              result = JSON.stringify({ error: `Unknown tool: ${tc.name}` })
            }
          } catch (e: any) {
            console.error('[assistant:agent] ✗ tool %s FAILED:', tc.name, { message: e?.message, stack: e?.stack?.split('\n').slice(0, 3) })
            result = JSON.stringify({ error: e?.message ?? 'tool_execution_failed' })
          }
          if (tc.name === 'emit_action') {
            action = parseAction(tc.input)
            if (action) console.log('[assistant:agent] ✓ emitted action:', action)
            else console.warn('[assistant:agent] ⚠ emit_action invalid:', tc.input)
          }
          return { tc, result, action }
        }),
      )

      // Yield results, actions, and feed back into conversation
      for (const { tc, result, action } of toolResults) {
        console.log('[assistant:agent] ← tool_result:', tc.name, result.slice(0, 200))
        yield { type: 'tool_result', name: tc.name, result }
        if (action) yield { type: 'action', action }
        turnMessages.push({
          role: 'user',
          content: `Tool "${tc.name}" returned:\n${result}`,
        })
      }

      console.log('[assistant:agent] ── iter %d complete, continuing loop ──', iter)
    }

    console.warn('[assistant:agent] ⚠ max iterations (%d) reached — stopping agent loop', maxIters)
   yield { type: 'end' }
}

// Re-export for the route
export { inferMode, resolveSession }
