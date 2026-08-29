import { Router } from '@/lib/http'
import { claudeTextWithSearch, streamClaude, extractJson, hasClaude, MODELS } from '@/lib/claude'
import { hasMistral, mistralText, mistralTextStream } from '@/lib/mistral'
import { hasGroq, groqText, groqTextStream } from '@/lib/groq'
import { COMPANY_STREAM_SYSTEM, RESEARCH_ASK_SYSTEM, researchAskUser } from './helpers'
import { getCachedResearch, setCachedResearch, formatResearchToMarkdown } from '@/lib/companyResearchCache'

export function registerResearch(r: Router) {
  /* ---------- §8.3 Company research ---------- */
  r.post('/company', async (req, res) => {
    const { company, role, force } = req.body ?? {}
    const system =
      'You are a rigorous career researcher writing for an early-career African/global student. CRITICAL HONESTY RULES: 1) If you cannot find verifiable information about a claim, write "[I could not find reliable sources]" instead of guessing. 2) Never fabricate reviews, salaries, growth figures, or layoff data. 3) If data is scarce, say so explicitly. 4) Surface REAL risks (layoffs, funding trouble, poor reviews, visa limits) when the evidence shows them — framed constructively but never sugar-coated. Reply ONLY with JSON: {"overview","culture","opportunity","red_flags","questions":["..","..",".."],"verdict"}.'
    const userText = `Company: ${company}. Role: ${role ?? 'an early-career role'}. Provide what you know about this company.`
    const enc = new TextEncoder()

    // Cache lookup (unless force=true forces a fresh search)
    if (!force) {
      const cached = await getCachedResearch(company, role)
      if (cached?.json) {
        return res.json({ ...cached.json, _cached: true, _provider: cached.provider })
      }
    }

    // Groq first (groq/compound)
    if (hasGroq()) {
      const text = await groqText({ system, user: userText, maxTokens: 900 })
      const parsed = text ? extractJson<any>(text) : null
      if (parsed) {
        const mdText = formatResearchToMarkdown(parsed)
        await setCachedResearch(company, role, mdText, parsed, 'groq')
        return res.json({ ...parsed, _provider: 'groq' })
      }
    }

    // Claude (web search)
    if (hasClaude()) {
      const text = await claudeTextWithSearch({
        model: MODELS.research,
        maxTokens: 900,
        system,
        user: `Company: ${company}. Role: ${role ?? 'an early-career role'}. Search for recent, specific information before answering.`,
      })
      const parsed = extractJson<any>(text)
      if (parsed) {
        const mdText = formatResearchToMarkdown(parsed)
        await setCachedResearch(company, role, mdText, parsed, 'claude')
        return res.json({ ...parsed, _provider: 'claude' })
      }
    }

    // Mistral fallback
    if (hasMistral()) {
      const text = await mistralText({ system, user: userText, maxTokens: 900 })
      const parsed = text ? extractJson<any>(text) : null
      if (parsed) {
        const mdText = formatResearchToMarkdown(parsed)
        await setCachedResearch(company, role, mdText, parsed, 'mistral')
        return res.json({ ...parsed, _provider: 'mistral' })
      }
    }

    // No API key configured — hardcoded safety net only. Be explicit about the
    // limitation so students don't mistake this for real research.
    const fallback = {
      overview: `${company} — I could not access real-time web research tools to verify current information. The details below are generic guidance, not company-verified facts.`,
      culture: `Without verified sources, I cannot confirm the actual culture. As with any role, ask the hiring manager about mentorship, team structure, and work norms directly.`,
      opportunity: `Without verified sources, I cannot confirm specific growth opportunities at ${company}. Generic advice: seek roles with clear ownership, a named mentor, and measurable first-90-day goals.`,
      red_flags: `Generic risks for any early-career role: unclear expectations, scope creep, or remote-tool friction. Verify the company's current funding, recent news, and visa policies before committing.`,
      questions: [`What does success look like in the first 90 days of ${role ?? 'this role'}?`, 'How is mentorship structured for early-career hires?', "What's the team's approach to work-life balance?"],
      verdict: `I could not verify ${company}'s fit without web research. Contact the company directly for current opportunities and requirements.`,
    }
    await setCachedResearch(company, role, formatResearchToMarkdown(fallback), fallback, 'fallback')
    res.json(fallback)
  })

  // Streamed company research — markdown, live web-grounded, rendered token-by-token
  // so the student sees progress instead of waiting for a blocking call.
  // Priority: Groq (groq/compound) → Claude (web search) → Mistral → hardcoded safety net.
  r.post('/company/stream', async (req, res) => {
    const { company, role, force } = req.body ?? {}
    const system = COMPANY_STREAM_SYSTEM
    const userText = `Company: ${company}. Role: ${role ?? 'an early-career role'}. Search for recent, specific information before writing.`
    const enc = new TextEncoder()

    // Cache lookup — stream accumulated text immediately, then signal "done".
    if (!force) {
      const cached = await getCachedResearch(company, role)
      if (cached?.text) {
        const sseStream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ t: cached.text })}\n\n`))
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ t: 'done', cached: true })}\n\n`))
            controller.close()
          },
        })
        res.sse(sseStream)
        return
      }
    }

    // Groq streaming (primary research model: groq/compound)
    if (hasGroq()) {
      let accumulated = ''
      let provider = 'groq'
      const sseStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ t: '' })}\n\n`))
          await groqTextStream({ system, user: userText, maxTokens: 900 }, (tok) => {
            accumulated += tok
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ t: tok })}\n\n`))
          })
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ t: 'done' })}\n\n`))
          controller.close()
          await setCachedResearch(company, role, accumulated, null, provider)
        },
      })
      res.sse(sseStream)
      return
    }

    // Claude streaming (with web search)
    if (hasClaude()) {
      let accumulated = ''
      const mdStream = await streamClaude({
        model: MODELS.research,
        maxTokens: 900,
        system,
        user: userText,
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }],
        meta: { company },
      })
      if (!mdStream) return res.status(503).json({ error: 'ai_unavailable' })

      // streamClaude already emits SSE frames. Tee: forward raw bytes to the
      // response while parsing them to accumulate text for caching.
      const [a, b] = mdStream.tee()
      const cachePromise = (async () => {
        const decoder = new TextDecoder()
        let buf = ''
        const reader = b.getReader()
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (value) {
            buf += decoder.decode(value, { stream: true })
            const lines = buf.split('\n')
            buf = lines.pop() ?? ''
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const obj = JSON.parse(line.slice(6))
                  if (obj.t) accumulated += obj.t
                } catch {}
              }
            }
          }
        }
        await setCachedResearch(company, role, accumulated, null, 'claude')
      })()
      res.sse(a)
      void cachePromise
      return
    }

    // Fallback: Mistral streaming (no web search)
    if (hasMistral()) {
      let accumulated = ''
      const sseStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ t: '' })}\n\n`))
          await mistralTextStream({ system, user: userText, maxTokens: 900 }, (tok) => {
            accumulated += tok
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ t: tok })}\n\n`))
          })
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ t: 'done' })}\n\n`))
          controller.close()
          await setCachedResearch(company, role, accumulated, null, 'mistral')
        },
      })
      res.sse(sseStream)
      return
    }

    res.status(503).json({ error: 'ai_unavailable' })
  })

  r.post('/research/ask', async (req, res) => {
    const { company, role, question } = req.body ?? {}
    const userText = researchAskUser(company, role, question)

    // Groq first
    if (hasGroq()) {
      const text = await groqText({ system: RESEARCH_ASK_SYSTEM, user: userText, maxTokens: 600 })
      if (text) return res.json({ answer: text })
    }
    // Claude (web search)
    if (hasClaude()) {
      const text = await claudeTextWithSearch({
        model: MODELS.research,
        maxTokens: 600,
        system: RESEARCH_ASK_SYSTEM,
        user: userText,
      })
      if (text) return res.json({ answer: text })
    }
    // Mistral fallback
    if (hasMistral()) {
      const text = await mistralText({ system: RESEARCH_ASK_SYSTEM, user: userText, maxTokens: 600 })
      if (text) return res.json({ answer: text })
    }
    // Hardcoded safety net only — be explicit about the limitation.
    res.json({ answer: `I could not access web research tools to verify information about "${question}" for ${role ?? 'this role'} at ${company}. I cannot confirm facts without real-time sources — please verify with the company directly.` })
  })

  /* Streaming research answer — rendered token-by-token. */
  r.post('/research/ask/stream', async (req, res) => {
    const { company, role, question } = req.body ?? {}
    const system = RESEARCH_ASK_SYSTEM
    const userText = researchAskUser(company, role, question)
    const enc = new TextEncoder()

    // Groq streaming (primary: openai/gpt-oss-120b for chat)
    if (hasGroq()) {
      const sseStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ t: '' })}\n\n`))
          await groqTextStream({ system, user: userText, maxTokens: 600, chat: true }, (tok) => {
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ t: tok })}\n\n`))
          },)
          controller.close()
        },
      })
      res.sse(sseStream)
      return
    }

    // Claude streaming (with web search)
    if (hasClaude()) {
      const stream = streamClaude({
        model: MODELS.research,
        maxTokens: 600,
        system,
        user: userText,
        tools: [{ type: 'web_search_20260209', name: 'web_search' }],
      })
      if (!stream) return res.status(503).json({ error: 'ai_unavailable' })
      res.sse(stream)
      return
    }

    // Fallback: Mistral streaming
    if (hasMistral()) {
      const sseStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ t: '' })}\n\n`))
          await mistralTextStream({ system, user: userText, maxTokens: 600 }, (tok) => {
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ t: tok })}\n\n`))
          })
          controller.close()
        },
      })
      res.sse(sseStream)
      return
    }

    res.status(503).json({ error: 'ai_unavailable' })
  })
}
