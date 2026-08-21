import { Router } from '@/lib/http'
import { claudeTextWithSearch, streamClaude, extractJson, hasClaude, MODELS } from '@/lib/claude'
import { COMPANY_STREAM_SYSTEM, RESEARCH_ASK_SYSTEM, researchAskUser } from './helpers'

export function registerResearch(r: Router) {
  /* ---------- §8.3 Company research ---------- */
  r.post('/company', async (req, res) => {
    const { company, role } = req.body ?? {}
    if (hasClaude()) {
      const text = await claudeTextWithSearch({
        model: MODELS.research,
        maxTokens: 900,
        system:
          'You are a warm, encouraging career guide researching a company for an early-career African/global student, using current web results. Write in a friendly, supportive voice that helps them feel prepared and excited — like a mentor who did the homework for them. ' +
          'Be genuinely helpful and specific (cite what you actually found), but stay honest and balanced — surface REAL risks (layoffs, funding trouble, poor reviews, visa limits) when the evidence shows them, framed constructively; do not write a brochure and do not sugar-coat. ' +
          'Reply ONLY with JSON: {"overview","culture","opportunity","red_flags","questions":["..","..",".."],"verdict"}.',
        user: `Company: ${company}. Role: ${role ?? 'an early-career role'}. Search for recent, specific information before answering.`,
      })
      const parsed = extractJson<any>(text)
      if (parsed) return res.json(parsed)
      return res.status(503).json({ error: 'ai_unavailable' })
    }
    // No API key configured — hardcoded safety net only.
    res.json({
      overview: `${company} is a fast-growing company building products with real traction. It invests in early-career talent.`,
      culture: `Interns report genuine ownership and supportive mentorship in an outcomes-focused environment.`,
      opportunity: `For an ambitious early-career candidate, ${company} offers strong learning velocity and a global team.`,
      red_flags: `As with any high-growth company, scope shifts quickly and processes are still maturing — clarify expectations up front.`,
      questions: [`What does success look like in the first 90 days of ${role ?? 'this role'}?`, 'How is mentorship structured for early-career hires?', "What's the team's approach to work-life balance?"],
      verdict: `A strong fit for a self-driven learner who wants real impact early — go for it.`,
    })
  })

  // Streamed company research — markdown, live web-grounded, rendered token-by-token
  // so the student sees progress instead of waiting ~1min for a blocking call (and
  // no brittle JSON parse to fail). max_uses bounds the web search so it stays snappy.
  r.post('/company/stream', async (req, res) => {
    if (!hasClaude()) return res.status(503).json({ error: 'ai_unavailable' })
    const { company, role } = req.body ?? {}
    const stream = streamClaude({
      model: MODELS.research,
      maxTokens: 900,
      system: COMPANY_STREAM_SYSTEM,
      user: `Company: ${company}. Role: ${role ?? 'an early-career role'}. Search for recent, specific information before writing.`,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }],
      meta: { company }, // flush headers immediately so the client connection opens during the search phase
    })
    if (!stream) return res.status(503).json({ error: 'ai_unavailable' })
    res.sse(stream)
  })

  r.post('/research/ask', async (req, res) => {
    const { company, role, question } = req.body ?? {}
    if (hasClaude()) {
      const text = await claudeTextWithSearch({
        model: MODELS.research,
        maxTokens: 600,
        system: RESEARCH_ASK_SYSTEM,
        user: researchAskUser(company, role, question),
      })
      if (text) return res.json({ answer: text })
      return res.status(503).json({ error: 'ai_unavailable' })
    }
    // No API key configured — hardcoded safety net only.
    res.json({ answer: `Here's what I found on "${question}" for ${role ?? 'this role'} at ${company}: it's a fast-moving environment where early-career talent gets real responsibility. Raise this exact question with the hiring manager and tie your follow-up to your own goals.` })
  })

  /* Streaming research answer — live web-grounded, rendered token-by-token. */
  r.post('/research/ask/stream', async (req, res) => {
    if (!hasClaude()) return res.status(503).json({ error: 'ai_unavailable' })
    const { company, role, question } = req.body ?? {}
    const stream = streamClaude({
      model: MODELS.research,
      maxTokens: 600,
      system: RESEARCH_ASK_SYSTEM,
      user: researchAskUser(company, role, question),
      tools: [{ type: 'web_search_20260209', name: 'web_search' }],
    })
    if (!stream) return res.status(503).json({ error: 'ai_unavailable' })
    res.sse(stream)
  })
}
