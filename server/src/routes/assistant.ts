import { Router } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { sb, must, j } from '@/db'
import { ChatRequest } from '@/assistant/types'
import { processAssistantMessage, getFixed40Matches, employerShortlist } from '@/assistant/engine'
import { runAgent } from '@/assistant/agent'
import type { AssistantMode } from '@/assistant/types'

export const assistant = Router()
assistant.use(requireAuth)

/* ---------- Chat: immediate-injection AI assistant ---------- */
assistant.post('/chat', async (req, res) => {
  const parsed = ChatRequest.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({ error: 'bad_request', issues: parsed.error.issues })
  }

  const user = req.user!
  const message = parsed.data.message
  const sessionId = parsed.data.session_id
  const pageContext = (parsed.data.context?.pageContext as string) ?? (parsed.data.context?.page as string)
  const mode = parsed.data.mode ?? inferMode(user)

  try {
    const result = await processAssistantMessage(user.id, mode, message, {
      sessionId,
      pageContext,
    })
    res.json(result)
  } catch (e: any) {
    // Last-resort fallback: never let a DB/AI error crash the request.
    res.json({
      text: "I'm having trouble connecting right now. I've noted your request — please try again in a moment.",
      session_id: sessionId ?? `${user.id}_${mode}_${Date.now()}`,
      actions: [],
    })
  }
})

/* ---------- Conversation history ---------- */
assistant.get('/sessions/:id/messages', async (req, res) => {
  const sid = req.params.id
  try {
    const { data, error } = await sb
      .from('assistant_messages')
      .select('id,role,content,actions,created_at')
      .eq('session_id', sid)
      .order('created_at', { ascending: true })

    if (error) return res.status(400).json({ error: error.message })
    const messages = (data ?? []).map((m: any) => ({
      ...m,
      actions: j.parse(m.actions, []),
    }))
    res.json({ session_id: sid, messages })
  } catch {
    res.json({ session_id: sid, messages: [] })
  }
})

/* ---------- List sessions ---------- */
assistant.get('/sessions', async (req, res) => {
  const userId = req.user!.id
  const mode = req.query.mode
  try {
    let q = sb
      .from('assistant_sessions')
      .select('id,mode,context,is_active,created_at,updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })

    if (mode) q = q.eq('mode', mode)
    const { data, error } = await q
    if (error) return res.status(400).json({ error: error.message })
    res.json(data ?? [])
  } catch {
    res.json([])
  }
})

/* ---------- Demo: Fixed-40 matcher ---------- */
assistant.get('/match/:studentId', async (req, res) => {
  const matches = await getFixed40Matches(req.params.studentId)
  res.json({ matches })
})

/* ---------- Employer shortlist ---------- */
assistant.get('/jobs/:jobId/shortlist', async (req, res) => {
  const userId = req.user!.id
  try {
    const shortlist = await employerShortlist(req.params.jobId, userId)
    if (!shortlist) return res.status(404).json({ error: 'not_found' })
    res.json(shortlist)
  } catch {
    res.json({ job_id: req.params.jobId, matches: [] })
  }
})

/* ---------- Agentic task (streaming SSE) ---------- */
/* Runs the AI agent loop: Claude calls tools autonomously, the engine executes
   them, and results stream back as SSE frames so the client can render live
   progress + tool outcomes. */
assistant.post('/task', async (req, res) => {
  const parsed = ChatRequest.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({ error: 'bad_request', issues: parsed.error.issues })
  }
  const user = req.user!
  const message = parsed.data.message
  const sessionId = parsed.data.session_id
  const pageContext = (parsed.data.context?.pageContext as string) ?? (parsed.data.context?.page as string)
  const mode = parsed.data.mode ?? inferMode(user)

  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`))
      try {
        for await (const ev of runAgent(user.id, mode, message, { sessionId, pageContext })) {
          send({ event: ev.type, ...ev })
        }
        send({ event: 'end' })
      } catch (e: any) {
        send({ event: 'error', message: e?.message ?? 'agent_error' })
      } finally {
        controller.close()
      }
    },
  })

  res.sse(stream)
})

/** Infer assistant mode from the user's role on the platform. */
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
