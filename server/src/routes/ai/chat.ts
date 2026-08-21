import { Router } from '@/lib/http'
import { claudeText, streamClaude, hasClaude, MODELS } from '@/lib/claude'
import { studentRow, ensureResumeProfile, matchContext, chatSystem, canChat } from './helpers'

export function registerChat(r: Router) {
  /* ---------- §8.4 Chat (CV-aware, personalised) ---------- */
  r.post('/chat', async (req, res) => {
    const { message } = req.body ?? {}
    const row = await studentRow(req.user!.id)
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
      return res.status(503).json({ error: 'ai_unavailable' })
    }
    res.json({ text: canChat(message ?? '') }) // no key: safety net
  })

  /* Streaming chat — same CV-aware + match-aware prompt, rendered token-by-token. */
  r.post('/chat/stream', async (req, res) => {
    if (!hasClaude()) return res.status(503).json({ error: 'ai_unavailable' })
    const { message } = req.body ?? {}
    const row = await studentRow(req.user!.id)
    const [rp, matchInfo] = await Promise.all([ensureResumeProfile(row), matchContext(req.user!.id)])
    const stream = streamClaude({
      model: MODELS.chat,
      maxTokens: 1200,
      system: chatSystem(row, rp, matchInfo),
      user: message ?? '',
    })
    if (!stream) return res.status(503).json({ error: 'ai_unavailable' })
    res.sse(stream)
  })
}
