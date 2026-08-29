import { Router } from '@/lib/http'
import { claudeText, streamClaude, hasClaude, MODELS } from '@/lib/claude'
import { groqText, groqTextStream, hasGroq, groqChatModel } from '@/lib/groq'
import { studentRow, ensureResumeProfile, matchContext, chatSystem, canChat } from './helpers'

export function registerChat(r: Router) {
  /* ---------- §8.4 Chat (CV-aware, personalised) ---------- */
  r.post('/chat', async (req, res) => {
    const { message } = req.body ?? {}
    const row = await studentRow(req.user!.id)
    const enc = new TextEncoder()

    // Groq first (openai/gpt-oss-120b)
    if (hasGroq()) {
      const [rp, matchInfo] = await Promise.all([ensureResumeProfile(row), matchContext(req.user!.id)])
      const text = await groqText({
        system: chatSystem(row, rp, matchInfo),
        user: message ?? '',
        maxTokens: 1200,
      })
      if (text) return res.json({ text })
    }

    // Claude fallback
    if (hasClaude()) {
      const [rp, matchInfo] = await Promise.all([ensureResumeProfile(row), matchContext(req.user!.id)])
      const text = await claudeText({
        model: MODELS.chat,
        maxTokens: 1200,
        thinking: true,
        system: chatSystem(row, rp, matchInfo),
        user: message ?? '',
      })
      if (text) return res.json({ text })
    }

    res.json({ text: canChat(message ?? '') })
  })

  /* Streaming chat — rendered token-by-token. */
  r.post('/chat/stream', async (req, res) => {
    const { message } = req.body ?? {}
    const row = await studentRow(req.user!.id)
    const [rp, matchInfo] = await Promise.all([ensureResumeProfile(row), matchContext(req.user!.id)])
    const system = chatSystem(row, rp, matchInfo)
    const userText = message ?? ''
    const enc = new TextEncoder()

    // Groq streaming (openai/gpt-oss-120b)
    if (hasGroq()) {
      const sseStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ t: '' })}\n\n`))
          await groqTextStream({ system, user: userText, maxTokens: 1200, chat: true }, (tok) => {
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ t: tok })}\n\n`))
          })
          controller.close()
        },
      })
      res.sse(sseStream)
      return
    }

    // Claude streaming fallback
    if (hasClaude()) {
      const stream = streamClaude({
        model: MODELS.chat,
        maxTokens: 1200,
        system,
        user: userText,
      })
      if (!stream) return res.status(503).json({ error: 'ai_unavailable' })
      res.sse(stream)
      return
    }

    res.status(503).json({ error: 'ai_unavailable' })
  })
}
