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
    console.error('[assistant:chat] bad request — validation failed:', JSON.stringify(parsed.error.issues))
    return res.status(400).json({ error: 'bad_request', issues: parsed.error.issues })
  }

   const user = req.user!
   const message = parsed.data.message
   const sessionId = parsed.data.session_id
   const pageContext = (parsed.data.context?.pageContext as string) ?? (parsed.data.context?.page as string)
   const inferredMode = inferMode(user)
   const mode = parsed.data.mode === inferredMode ? inferredMode : inferredMode

   console.log(`[assistant:chat] ── NEW CHAT ── user=${user.id} mode=${mode} session=${sessionId ?? 'new'} page=${pageContext ?? 'none'}`, {
     message: message.slice(0, 200),
     has_context: !!parsed.data.context,
   })

   try {
     console.log('[assistant:chat] calling processAssistantMessage…')
     const result = await processAssistantMessage(user.id, mode, message, {
      sessionId,
      pageContext,
    })
    console.log('[assistant:chat] ✓ processAssistantMessage returned:', {
      text_len: (result.text || '').length,
      text_preview: (result.text || '').slice(0, 200),
      actions_count: result.actions?.length ?? 0,
      actions: result.actions?.map((a: any) => ({ type: a.type, target: a.target })),
      session_id: result.session_id,
    })
    res.json(result)
  } catch (e: any) {
    console.error('[assistant:chat] ✗ ERROR in processAssistantMessage:', {
      message: e?.message,
      stack: e?.stack?.split('\n').slice(0, 5),
      error_name: e?.name,
      error_cause: e?.cause,
      user_id: user.id,
      mode,
      input_message: message.slice(0, 200),
    })
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

/* ---------- Delete session ---------- */
assistant.delete('/sessions/:id', async (req, res) => {
  const userId = req.user!.id
  const sid = req.params.id
  try {
    const { error: msgErr } = await sb
      .from('assistant_messages')
      .delete()
      .eq('session_id', sid)
    if (msgErr) return res.status(400).json({ error: msgErr.message })

    const { error: sessErr } = await sb
      .from('assistant_sessions')
      .delete()
      .eq('id', sid)
      .eq('user_id', userId)
    if (sessErr) return res.status(400).json({ error: sessErr.message })
    res.json({ ok: true })
  } catch (e: any) {
    console.error('[assistant:delete] session delete failed:', e)
    res.status(500).json({ error: e?.message ?? 'delete_failed' })
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
  const jobId = req.params.jobId
  console.log('[assistant:shortlist] request:', { jobId, userId })
  try {
    const shortlist = await employerShortlist(jobId, userId)
    if (!shortlist) {
      console.warn('[assistant:shortlist] ✗ not found:', { jobId, userId })
      return res.status(404).json({ error: 'not_found' })
    }
    console.log('[assistant:shortlist] ✓ returned:', {
      jobId, userId, match_count: shortlist.match_count,
      scores: shortlist.matches?.map((m: any) => ({ score: m.score, name: m.name }))?.slice(0, 5),
    })
    res.json(shortlist)
  } catch (e: any) {
    console.error('[assistant:shortlist] ✗ ERROR:', {
      message: e?.message,
      stack: e?.stack?.split('\n').slice(0, 5),
      jobId, userId,
    })
    res.json({ job_id: jobId, matches: [] })
  }
})

/* ---------- Agentic task (streaming SSE) ---------- */
assistant.post('/task', async (req, res) => {
  const parsed = ChatRequest.safeParse(req.body ?? {})
  if (!parsed.success) {
    console.error('[assistant:task] bad request — validation failed:', JSON.stringify(parsed.error.issues))
    return res.status(400).json({ error: 'bad_request', issues: parsed.error.issues })
  }
  const user = req.user!
  const message = parsed.data.message
  const sessionId = parsed.data.session_id
  const pageContext = (parsed.data.context?.pageContext as string) ?? (parsed.data.context?.page as string)
  const inferredMode = inferMode(user)
  const mode = parsed.data.mode === inferredMode ? inferredMode : inferredMode

  console.log(`[assistant:task] ── NEW AGENTIC TASK ── user=${user.id} mode=${mode} session=${sessionId ?? 'new'} page=${pageContext ?? 'none'}`, {
    message: message.slice(0, 200),
  })

  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`))
      let eventCount = 0
      try {
        console.log('[assistant:task] starting runAgent…')
        for await (const ev of runAgent(user.id, mode, message, { sessionId, pageContext })) {
          eventCount++
          console.log('[assistant:task] ← event', eventCount, ev.type, {
            name: (ev as any).name,
            text_preview: (ev as any).text?.slice(0, 100),
            action: (ev as any).action,
            summary: (ev as any).summary?.slice(0, 100),
            error: (ev as any).message,
          })
          send({ event: ev.type, ...ev })
        }
        console.log(`[assistant:task] ✓ runAgent completed — ${eventCount} events streamed`)
        send({ event: 'end' })
      } catch (e: any) {
        console.error('[assistant:task] ✗ ERROR in runAgent:', {
          message: e?.message,
          stack: e?.stack?.split('\n').slice(0, 5),
          error_name: e?.name,
          events_before_error: eventCount,
        })
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
