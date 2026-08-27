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

5. get_employer_shortlist(job_id: string) — Get ranked candidates for a posted job.

6. emit_action(type: "inject_data"|"navigate"|"update_profile"|"add_evidence", target: string, data: object) — Emit a client-side action to execute immediately (e.g. navigate to a page, auto-fill a form).

7. save_message(session_id: string, role: string, content: string) — Persist a message to conversation history for audit.
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
  emit_action: async (input) => {
    let type = getParam(input, 'type') as string
    let target = getParam(input, 'target') as string
    // Normalize type variants
    const NAV_TYPES = ['navigate', 'navigation', 'navigate_to', 'go_to', 'redirect']
    if (NAV_TYPES.includes(type)) type = 'navigate'
    // Normalize target to a route path
    if (type === 'navigate') {
      if (!target) target = '/app'
      else if (!target.startsWith('/')) target = `/app/${target}`
    }
    return JSON.stringify({ emitted: true, type, target })
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
  `You are the Optryva Assistant — a focused AI that executes exactly what the user asks. ` +
  `Do NOT do extra work. Do NOT ask questions. Just call the tools needed to complete the request. ` +
  `After calling tools, if the task is complete, return tool_calls: [].\n\n` +
  `${TOOL_DESCRIPTIONS}\n\n` +
  `Return ONLY valid JSON matching this schema:\n` +
  `{"text":"your brief reply","tool_calls":[{"name":"tool_name","input":{}}]}` +
  `\nIf you are done, return tool_calls: []. No extra steps.`;

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

  // 0. Resolve session (with fallback when Supabase is unavailable)
  let sessionId: string
  try {
    sessionId = await resolveSession(userId, mode, opts?.sessionId)
  } catch {
    sessionId = opts?.sessionId ?? `${userId}_${mode}_${Date.now()}`
  }

  // 1. Gather context (with fallback)
  let context: string
  try {
    if (mode === 'student') context = await getStudentContext(userId)
    else if (mode === 'employer') context = await getEmployerContext(userId)
    else context = await getUniversityContext(userId)
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
    await sb.from('assistant_messages').insert({
      session_id: sessionId,
      role: 'user',
      content: message,
    })
  } catch { /* non-critical */ }

  // 3. Agent loop
  for (let iter = 0; iter < maxIters; iter++) {
    const parsed = await generateTurn<{ text: string; tool_calls: { name: string; input: ToolInput }[] }>({
      system: SYSTEM_PROMPT,
      messages: turnMessages,
      schema: AGENT_SCHEMA,
      maxTokens: 1000,
    })

    if (!parsed) {
      yield { type: 'error', message: 'The AI provider returned an empty response.' }
      yield { type: 'done', summary: 'Error: no response from AI provider.' }
      return
    }

    // Emit text
    if (parsed.text) {
      yield { type: 'text', text: parsed.text }
    }

    // Process tool calls
    const toolCalls = parsed.tool_calls ?? []
    if (toolCalls.length === 0) {
      // Agent is done — persist its final text
      if (parsed.text) {
        await sb.from('assistant_messages').insert({
          session_id: sessionId,
          role: 'assistant',
          content: parsed.text,
        })
      }
      yield { type: 'done', summary: parsed.text || 'Done!' }
      break
    }

    // Assistant's turn (text + tool_calls)
    const assistantContent = JSON.stringify({ text: parsed.text, tool_calls: parsed.tool_calls })
    turnMessages.push({ role: 'assistant', content: assistantContent })

    for (const tc of toolCalls) {
      yield { type: 'tool_use', name: tc.name, input: tc.input }

      const executor = TOOL_EXECUTORS[tc.name]
      let result: string
      try {
        if (executor) {
          result = await executor(tc.input, userId, mode)
        } else {
          result = JSON.stringify({ error: `Unknown tool: ${tc.name}` })
        }
      } catch (e: any) {
        result = JSON.stringify({ error: e?.message ?? 'tool_execution_failed' })
      }

      yield { type: 'tool_result', name: tc.name, result }

      // If the tool was emit_action, also yield an action event for the client
      if (tc.name === 'emit_action') {
        try {
          const action = JSON.parse(tc.input as any) as AssistantAction
          yield { type: 'action', action }
        } catch { /* ignore */ }
      }

      // Feed result back as a user turn
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
