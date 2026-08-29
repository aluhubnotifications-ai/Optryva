/**
 * Groq provider for the Optryva Assistant.
 *
 * Uses the OpenAI-compatible API at https://api.groq.com/openai/v1/chat/completions
 * with the model `openai/gpt-oss-20b` (or override via GROQ_MODEL env var).
 *
 * This provider is used ONLY for the assistant (chat + agentic loop).
 * All other AI features (assessment generation, etc.) continue to use
 * Mistral/Claude as configured elsewhere.
 */

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const CHAT_MODEL = 'openai/gpt-oss-120b'
const RESEARCH_MODEL = 'groq/compound'

export function hasGroq(): boolean {
  try { return !!process.env.GROQ_API_KEY } catch { return false }
}

/** Model used for assistant chat and general text generation. */
export function groqChatModel(): string {
  return process.env.GROQ_CHAT_MODEL || CHAT_MODEL
}

/** Model used for company research (web-grounded answers). */
export function groqResearchModel(): string {
  return process.env.GROQ_RESEARCH_MODEL || RESEARCH_MODEL
}

/** Backwards-compatible: same as groqChatModel(). */
export function groqModel(): string {
  return groqChatModel()
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

interface GroqChatOpts {
  system: string
  messages: ChatMessage[]
  schema?: unknown
  maxTokens?: number
  temperature?: number
}

/**
 * Single-turn or multi-turn JSON-structured chat completion via Groq.
 * Returns parsed JSON matching T, or null on failure.
 */
export async function groqChatJson<T>(opts: GroqChatOpts & { _retry?: boolean }): Promise<T | null> {
  if (!hasGroq()) {
    console.warn('[groq] ⚠ GROQ_API_KEY not set')
    return null
  }
  const model = groqModel()
  const systemPrompt = opts.schema
    ? `${opts.system}\n\nYou MUST output valid JSON. Do not include any text outside the JSON object. The JSON must match this schema:\n${JSON.stringify(opts.schema)}`
    : opts.system

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 12000)
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...opts.messages],
        ...(opts.schema ? { response_format: { type: 'json_object' } } : {}),
        max_tokens: opts.maxTokens ?? 2000,
        ...(opts.temperature != null ? { temperature: opts.temperature } : { temperature: 0.1 }),
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId))

    if (!res.ok) {
      const errBody = await res.text()
      console.error('[groq] ✗ HTTP error in groqChatJson:', {
        status: res.status,
        statusText: res.statusText,
        body: errBody.slice(0, 500),
        model,
      })
      if ((res.status === 503 || res.status === 429 || res.status === 502 || res.status === 504) && !opts._retry) {
        console.log('[groq] ↻ retrying after transient error...')
        await new Promise((r) => setTimeout(r, 2000))
        return groqChatJson<T>({ ...opts, _retry: true })
      }
      if (res.status === 400 && !opts._retry && opts.schema) {
        console.log('[groq] ↻ output_parse_failed — retrying without response_format...')
        return groqChatJsonRaw<T>({ ...opts, _retry: true })
      }
      return null
    }

    const data: any = await res.json()
    const text: string | undefined = data?.choices?.[0]?.message?.content
    if (!text) {
      console.warn('[groq] ⚠ empty content from Groq response:', { model, data: JSON.stringify(data).slice(0, 300) })
      return null
    }

    try {
      return JSON.parse(text) as T
    } catch {
      console.warn('[groq] ⚠ response was not valid JSON, trying extractJson fallback')
      const { extractJson } = await import('@/lib/claude')
      return extractJson<T>(text)
    }
  } catch (e: any) {
    console.error('[groq] ✗ error in groqChatJson:', {
      message: e?.message,
      name: e?.name,
      stack: e?.stack?.split('\n').slice(0, 5),
      model,
    })
    return null
  }
}

/**
 * Retry a JSON-mode request without `response_format` — used when the model
 * fails to produce parseable output with structured mode enabled.
 * Falls back to extractJson for prose responses that contain JSON.
 */
export async function groqChatJsonRaw<T>(opts: GroqChatOpts & { _retry?: boolean }): Promise<T | null> {
  if (!hasGroq()) return null
  const model = groqModel()
  const systemPrompt = opts.schema
    ? `${opts.system}\n\nYou MUST output valid JSON. Do not include any text outside the JSON object. The JSON must match this schema:\n${JSON.stringify(opts.schema)}`
    : opts.system

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 12000)
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...opts.messages],
        max_tokens: opts.maxTokens ?? 2000,
        ...(opts.temperature != null ? { temperature: opts.temperature } : { temperature: 0.1 }),
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId))

    if (!res.ok) {
      console.error('[groq:raw] ✗ HTTP error:', { status: res.status, body: (await res.text()).slice(0, 500) })
      return null
    }

    const data: any = await res.json()
    const text: string | undefined = data?.choices?.[0]?.message?.content
    if (!text) return null

    try {
      return JSON.parse(text) as T
    } catch {
      console.warn('[groq:raw] ⚠ not valid JSON, trying extractJson fallback')
      const { extractJson } = await import('@/lib/claude')
      return extractJson<T>(text)
    }
  } catch (e: any) {
    console.error('[groq:raw] ✗ error:', { message: e?.message, name: e?.name })
    return null
  }
}

/**
 * Plain-text completion via Groq. Used by tools (e.g. deep_inspect) for
 * free-form text extraction.
 */
export async function groqText(opts: {
  system: string
  user: string
  maxTokens?: number
}): Promise<string | null> {
  if (!hasGroq()) {
    console.warn('[groq] ⚠ GROQ_API_KEY not set')
    return null
  }
  const model = groqModel()

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 12000)
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        max_tokens: opts.maxTokens ?? 1000,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId))

    if (!res.ok) {
      const errBody = (await res.text()).slice(0, 500)
      console.error('[groq] ✗ HTTP error in groqText:', {
        status: res.status,
        statusText: res.statusText,
        body: errBody,
        model,
      })
      return null
    }

    const data: any = await res.json()
    const text: string | undefined = data?.choices?.[0]?.message?.content
    if (!text) {
      console.warn('[groq] ⚠ empty response from groqText:', { model })
      return null
    }
    return text.trim()
  } catch (e: any) {
    console.error('[groq] ✗ error in groqText:', {
      message: e?.message,
      name: e?.name,
      stack: e?.stack?.split('\n').slice(0, 3),
      model,
    })
    return null
  }
}

/**
 * Streaming text completion via Groq (SSE-compatible with the same `data: {t}`
 * frame format used by streamClaude). Returns true if any tokens were emitted.
 * Uses groqResearchModel() by default — pass `chat=true` for groqChatModel().
 */
export async function groqTextStream(
  opts: { system: string; user: string; maxTokens?: number; chat?: boolean },
  onToken: (t: string) => void,
): Promise<boolean> {
  if (!hasGroq()) return false
  const model = opts.chat ? groqChatModel() : groqResearchModel()
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 25000)
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        max_tokens: opts.maxTokens ?? 1000,
        stream: true,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId))

    if (!res.ok) {
      console.error('[groq] ✗ stream HTTP error:', { status: res.status, body: (await res.text()).slice(0, 200) })
      return false
    }

    const reader = res.body?.getReader()
    if (!reader) return false
    const dec = new TextDecoder()
    let buf = ''
    let got = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const payload = t.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const obj = JSON.parse(payload)
          const delta = obj?.choices?.[0]?.delta?.content
          if (delta) { got = true; onToken(delta) }
        } catch { /* ignore partial frames */ }
      }
    }
    return got
  } catch (e: any) {
    console.error('[groq] ✗ stream error:', { message: e?.message, name: e?.name })
    return false
  }
}

// ---------------------------------------------------------------------------
// Match review — batched batch evidence review for the matching engine.
// Groq is used ONLY for evidence interpretation, ambiguity resolution, gap
// analysis, confidence, and explanation. It does NOT control access, privacy,
// hard filters, or the final score formula.
// ---------------------------------------------------------------------------

// Rate governance state — tracks 429 responses and delays.
let _rateGovernor = {
  retryAfter: 0,
  remaining: Infinity,
  resetAt: 0,
}

/** Check if we should delay due to rate limiting. Returns true if still limited. */
export function groqRateLimited(): boolean {
  if (_rateGovernor.retryAfter > Date.now()) return true
  return false
}

/** Get the remaining request budget from rate governance. */
export function groqRemainingBudget(): number {
  return _rateGovernor.remaining
}

/**
 * Batched match review via Groq.
 * Sends multiple student-job-resume pairs in a single request for evidence
 * interpretation, ambiguity resolution, gap analysis, confidence, and explanation.
 *
 * The model receives normalized compact evidence, not raw résumé files.
 * The prompt explicitly says all claims must be grounded in supplied data
 * and that unknown evidence must remain unknown.
 *
 * Returns typed errors distinguishing: rate-limited, timeout, invalid-output,
 * provider-unavailable, and configuration errors.
 */
export type GroqMatchError =
  | { type: 'rate_limited'; retryAfter: number }
  | { type: 'timeout' }
  | { type: 'invalid_output' }
  | { type: 'provider_unavailable' }
  | { type: 'config_error' }

import type { GroqMatchInput, AiReviewResult } from '@/lib/matching'

// Dedicated second API key for the matching engine only — all tiers of matching
// traffic come from this account. The existing GROQ_API_KEY is for the assistant.
// Fallback models are tried in order if the primary model is unavailable or
// rate-limited, including Grok models.
const MATCH_API_KEY = process.env.GROQ_MATCH_API_KEY || process.env.GROQ_API_KEY
const MATCH_MODEL = process.env.GROQ_MATCH_MODEL || 'meta-llama/llama-4-maestro-17b-16e-instruct'
const MATCH_FALLBACK_MODELS: string[] = (
  process.env.GROQ_MATCH_FALLBACK_MODELS ||
  'llama-3.1-8b-instant,mixtral-8x7b-32768,grok-1.5v,grok-1.5'
).split(',').map((m) => m.trim())
const MATCH_PROMPT_VERSION = process.env.GROQ_MATCH_PROMPT_VERSION || 'match-prompt-v1'

/** True when a matching Groq key is configured (uses the dedicated key or falls back). */
export function hasMatchGroq(): boolean {
  try { return !!MATCH_API_KEY } catch { return false }
}

/** The primary model for matching. */
export function groqMatchModel(): string {
  return process.env.GROQ_MATCH_MODEL || MATCH_MODEL
}

/** Fallback models to try when the primary model fails (including Grok). */
export function groqMatchFallbackModels(): string[] {
  return MATCH_FALLBACK_MODELS
}

/** Prompt version for the matching system prompt. */
export function groqMatchPromptVersion(): string {
  return MATCH_PROMPT_VERSION
}

export async function groqBatchMatchReview(
  inputs: GroqMatchInput[],
  opts?: { maxTokens?: number; _retry?: boolean },
): Promise<{ results: AiReviewResult[] } | { error: GroqMatchError }> {
  if (!hasMatchGroq()) {
    return { error: { type: 'config_error' } }
  }

  if (_rateGovernor.retryAfter > Date.now()) {
    return { error: { type: 'rate_limited', retryAfter: _rateGovernor.retryAfter - Date.now() } }
  }

  // Build the list of models to try — primary first, then fallbacks (including
  // Grok models) in case the primary is unavailable or out of credit.
  const modelCandidates = [groqMatchModel(), ...groqMatchFallbackModels()]
  const apiKey = MATCH_API_KEY

  // Build the system prompt
  const systemPrompt = `You are Optryva's evidence-based career matching reviewer.

Review each supplied student-resume/job pair using ONLY the structured data provided.
Do not invent skills, projects, employment, education, assessment scores, salary data,
company facts, or responsibilities. Do not use or infer protected characteristics such
as gender, age, ethnicity, nationality, religion, disability, photograph, or family status.
Treat missing evidence as unknown, not as proof that a person lacks the skill.

The deterministic filter_points and rank_position are provided as context. Do not change
hard eligibility, privacy, school access, or the deterministic score weights. Return one
result for every pair_id. Return JSON only.

The model may receive résumé content, coursework, work history, portfolio projects,
GitHub metadata, deployed project descriptions, certificates, and other authorized
student evidence. You may not inspect unauthorized private resources or claim that a
link proves a skill without evidence.

Output format (JSON):
{
  "results": [
    {
      "pair_id": "student_id:job_id:resume_id",
      "ai_quality": 0,
      "confidence": "low" | "medium" | "high",
      "evidence": [
        {
          "requirement": "SQL",
          "status": "proven" | "partial" | "unknown" | "contradicted",
          "proof": "Student project description supplied in the input"
        }
      ],
      "skill_gaps": ["Power BI"],
      "reasons": ["The résumé contains evidence of SQL analysis, but Power BI evidence is unknown."],
      "needs_human_review": false
    }
  ]
}

Allowed values:
- confidence: "low" | "medium" | "high"
- status: "proven" | "partial" | "unknown" | "contradicted"
- ai_quality: integer 0-100 (0 = low quality match, 100 = perfect evidence-backed match)
- needs_human_review: boolean

Reject behavior: if you cannot evaluate a pair, still return a result with
ai_quality=0, confidence="low", and a reason explaining what evidence is missing.`

  // Build the user message — compact JSON, no private raw files
  const userMessage = JSON.stringify({
    pairs: inputs.map((p) => ({
      pair_id: p.pair_id,
      student_id: p.student_id,
      job_title: p.job_title,
      job_description: p.job_description.slice(0, 2000),
      job_qualifications: p.job_qualifications,
      job_tags: p.job_tags,
      resume_skills: p.resume_skills,
      resume_domains: p.resume_domains,
      resume_roles: p.resume_roles,
      resume_projects: p.resume_projects,
      resume_summary: p.resume_summary?.slice(0, 1000),
      total_years: p.total_years,
      portfolio_evidence: p.portfolio_evidence.map((e: any) => ({
        title: e.title,
        description: e.description.slice(0, 500),
        confirmed_skills: e.confirmed_skills,
        extracted_skills: e.extracted_skills,
        status: e.status,
      })),
      matched_skills: p.matched_skills,
      missing_skills: p.missing_skills,
      filter_points: p.filter_points,
      rank_position: p.rank_position,
      semantic_similarity: p.semantic_similarity,
      evidence_completeness: p.evidence_completeness,
    })),
  })

  try {
    let res: Response | null = null
    let modelUsed = ''
    // Try each model candidate in order — primary first, then fallbacks
    // (including Grok models) if the primary is unavailable or out of credit.
    for (const modelName of modelCandidates) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)
      try {
        res = await fetch(GROQ_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelName,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage },
            ],
            response_format: { type: 'json_object' },
            max_tokens: opts?.maxTokens ?? 8000,
            temperature: 0.1,
          }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeoutId))
      } catch (e: any) {
        if (e?.name === 'AbortError') {
          res = null
          continue // try next model
        }
        res = null
        continue
      }

      if (res.ok) {
        modelUsed = modelName
        break
      }

      const errBody = await res.text()
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after') ?? 5) * 1000
        _rateGovernor.retryAfter = Date.now() + Math.min(retryAfter, 60000)
        return { error: { type: 'rate_limited', retryAfter } }
      }
      if (res.status === 503 || res.status === 502 || res.status === 504) {
        // Try next model
        continue
      }
      if (res.status === 400) {
        if (modelName !== modelCandidates[modelCandidates.length - 1]) {
          // Try next fallback model
          continue
        }
        return { error: { type: 'invalid_output' } }
      }
      if (res.status === 401 || res.status === 403) {
        console.error('[groq:match] auth error for matching key:', errBody.slice(0, 200))
        return { error: { type: 'config_error' } }
      }
      // Other error — try next model
      continue
    }

    if (!res || !res.ok) {
      return { error: { type: 'provider_unavailable' } }
    }

    console.log('[groq:match] succeeded with model:', modelUsed)

    // Track rate limit headers
    const remaining = Number(res.headers.get('x-ratelimit-remaining'))
    if (!isNaN(remaining)) _rateGovernor.remaining = remaining
    const reset = Number(res.headers.get('x-ratelimit-reset'))
    if (!isNaN(reset)) _rateGovernor.resetAt = reset * 1000

    const data: any = await res.json()
    const text: string | undefined = data?.choices?.[0]?.message?.content
    if (!text) {
      return { error: { type: 'invalid_output' } }
    }

    let parsed: any
    try {
      parsed = JSON.parse(text) as { results: AiReviewResult[] }
    } catch {
      const { extractJson } = await import('@/lib/claude')
      parsed = extractJson<{ results: AiReviewResult[] }>(text)
      if (!parsed?.results) return { error: { type: 'invalid_output' } }
    }

    // Validate the output — every requested pair_id must be present
    const inputIds = new Set(inputs.map((i) => i.pair_id))
    const outputIds = new Set<string>(parsed.results.map((r: any) => String(r.pair_id)))
    if (inputIds.size !== outputIds.size ||
        ![...inputIds].every((id) => outputIds.has(id))) {
      console.warn('[groq:match] output validation: pair_id mismatch',
        JSON.stringify([...inputIds]), JSON.stringify([...outputIds]))
      return { error: { type: 'invalid_output' } }
    }

    // Validate ranges
    const validResults: AiReviewResult[] = []
    for (const r of parsed.results) {
      if (typeof r.ai_quality !== 'number' || r.ai_quality < 0 || r.ai_quality > 100) {
        return { error: { type: 'invalid_output' } }
      }
      if (!['low', 'medium', 'high'].includes(r.confidence)) {
        return { error: { type: 'invalid_output' } }
      }
      validResults.push({
        pair_id: r.pair_id,
        ai_quality: r.ai_quality,
        confidence: r.confidence,
        evidence: (r.evidence ?? []) as any,
        skill_gaps: r.skill_gaps ?? [],
        reasons: r.reasons ?? [],
        needs_human_review: r.needs_human_review ?? false,
      })
    }

    return { results: validResults }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return { error: { type: 'timeout' } }
    }
    console.error('[groq:match] ✗ error:', { message: e?.message, name: e?.name })
    return { error: { type: 'provider_unavailable' } }
  }
}
