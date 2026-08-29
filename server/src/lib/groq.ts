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
