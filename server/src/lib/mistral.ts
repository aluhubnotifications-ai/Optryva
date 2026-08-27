import { recordUsage } from '@/lib/usage'
import { extractJson } from '@/lib/claude'
import { extractText } from 'unpdf'

// ----------------------------------------------------------------------------
// Mistral AI client (assessment generation). Used as an alternative provider to
// Claude for designing candidate assignments.
//   - Text-only briefs run on MISTRAL_MODEL (mistral-large-latest, the smartest).
//   - When the brief includes images, we switch to MISTRAL_VISION_MODEL
//     (pixtral-large-latest) which can *see* images directly, and we extract text
//     from PDFs locally (unpdf) so Mistral reads the real brief, not a placeholder.
// ----------------------------------------------------------------------------

/** Mistral's top text model. Override with the MISTRAL_MODEL env var. */
export const MISTRAL_MODEL = process.env.MISTRAL_MODEL || 'mistral-large-latest'

/** Mistral's multimodal model — reads images. Used automatically when a source
 *  image is present. Override with MISTRAL_VISION_MODEL. */
export const MISTRAL_VISION_MODEL = process.env.MISTRAL_VISION_MODEL || 'pixtral-large-latest'

export function hasMistral(): boolean {
  return !!process.env.MISTRAL_API_KEY
}

const ENDPOINT = 'https://api.mistral.ai/v1/chat/completions'

/**
 * Core call. The user turn is a content-part array (text and/or image_url) so the
 * same function serves text-only and vision requests. `response_format:
 * json_object` steers the model to emit parseable JSON; we also tolerate
 * fenced/prose output via `extractJson`. Returns the parsed object, or null on any
 * failure (no key, network, non-JSON) so callers can fall back.
 */
async function mistralJson<T>(opts: {
  model?: string
  system: string
  content: any[]
  maxTokens?: number
  temperature?: number
}): Promise<T | null> {
  if (!hasMistral()) return null
  const model = opts.model ?? MISTRAL_MODEL
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 12000)
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.content },
        ],
        response_format: { type: 'json_object' },
        max_tokens: opts.maxTokens ?? 1200,
        ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      }),
      signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId))
      if (!res.ok) {
        const errBody = (await res.text()).slice(0, 500)
        console.error('[mistral] ✗ HTTP error in mistralJson:', {
          status: res.status, statusText: res.statusText,
          body: errBody, model,
        })
        return null
      }
      const data: any = await res.json()
      const usage = data?.usage
      if (usage) {
        recordUsage(model, { input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0 })
      }
      const text: string | undefined = data?.choices?.[0]?.message?.content
      if (!text) {
        console.warn('[mistral] ⚠ empty response from mistralJson:', { model })
        return null
      }
      try {
        return JSON.parse(text) as T
      } catch {
        console.warn('[mistral] ⚠ mistralJson response not valid JSON, using extractJson fallback')
        return extractJson<T>(text)
      }
    } catch (e: any) {
      console.error('[mistral] ✗ error in mistralJson:', {
        message: e?.message, name: e?.name,
        stack: e?.stack?.split('\n').slice(0, 3), model,
      })
      return null
    }
  }

/**
 * Structured completion where the user turn is a content-part array — callers
 * pass Mistral parts: `{ type:'text', text }` and/or `{ type:'image_url',
 * image_url:{ url } }` (data URLs). When `schema` is given it's appended to the
 * system prompt as a shape hint (Mistral does not hard-enforce it). Falls back to
 * null on any failure so the route can try the next provider.
 */
export async function mistralJsonBlocks<T>(opts: {
  model?: string
  system: string
  content: any[]
  schema?: unknown
  maxTokens?: number
  temperature?: number
}): Promise<T | null> {
  if (!hasMistral()) return null
  if (!opts.content?.length) return null
  const system = opts.schema
    ? `${opts.system}\n\nReturn ONLY valid JSON matching this schema (no prose, no code fences):\n${JSON.stringify(opts.schema)}`
    : opts.system
  return mistralJson<T>({ model: opts.model ?? MISTRAL_MODEL, system, content: opts.content, maxTokens: opts.maxTokens ?? 2000, temperature: opts.temperature })
}

/**
 * Multi-turn chat completion with optional JSON-mode structured output.
 * Accepts a full messages array (system, user, assistant, tool) — used by the
 * agentic loop where tool results are fed back between turns. When `schema`
 * is provided, the response is steered to JSON-object mode and parsed; otherwise
 * plain text is returned.
 *
 * Message roles follow the OpenAI/Mistral convention:
 *   { role: 'system', content: string }
 *   { role: 'user',   content: string }
 *   { role: 'assistant', content: string }
 */
export async function mistralChat<T>(opts: {
  model?: string
  system: string
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; tool_name?: string }>
  schema?: unknown
  maxTokens?: number
  temperature?: number
}): Promise<T | null> {
  if (!hasMistral()) return null
  const model = opts.model ?? MISTRAL_MODEL
  const systemPrompt = opts.schema
    ? `${opts.system}\n\nReturn ONLY valid JSON matching this schema (no prose, no code fences):\n${JSON.stringify(opts.schema)}`
    : opts.system
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 12000)
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...opts.messages],
        ...(opts.schema ? { response_format: { type: 'json_object' } } : {}),
        max_tokens: opts.maxTokens ?? 2000,
        ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId))
    if (!res.ok) {
      const errBody = (await res.text()).slice(0, 500)
      console.error('[mistral] ✗ HTTP error in mistralChat:', {
        status: res.status, statusText: res.statusText,
        body: errBody, model,
      })
      return null
    }
    const data: any = await res.json()
    const usage = data?.usage
    if (usage) {
      recordUsage(model, {
        input_tokens: usage.prompt_tokens ?? 0,
        output_tokens: usage.completion_tokens ?? 0,
      })
    }
    const text: string | undefined = data?.choices?.[0]?.message?.content
    if (!text) {
      console.warn('[mistral] ⚠ empty response from mistralChat:', { model, data: JSON.stringify(data).slice(0, 200) })
      return null
    }
    try {
      return JSON.parse(text) as T
    } catch {
      console.warn('[mistral] ⚠ response was not valid JSON, using extractJson fallback')
      return extractJson<T>(text)
    }
  } catch (e: any) {
    console.error('[mistral] ✗ error in mistralChat:', {
      message: e?.message, name: e?.name,
      stack: e?.stack?.split('\n').slice(0, 3), model,
    })
    return null
  }
}

/**
 * Plain-text completion (no JSON coercion). Used for free-form employer research
 * answers where we want prose, not structured output. Returns the trimmed text, or
 * null on any failure (no key, network, empty response) so the caller can fall back
 * to another provider.
 */
export async function mistralText(opts: { system: string; user: string; maxTokens?: number }): Promise<string | null> {
  if (!hasMistral()) return null
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 12000)
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MISTRAL_MODEL,
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
       console.error('[mistral] ✗ HTTP error in mistralText:', {
         status: res.status, statusText: res.statusText,
         body: errBody, model: MISTRAL_MODEL,
       })
       return null
     }
     const data: any = await res.json()
     const usage = data?.usage
     if (usage) recordUsage(MISTRAL_MODEL, { input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0 })
     const text: string | undefined = data?.choices?.[0]?.message?.content
     if (!text) {
       console.warn('[mistral] ⚠ empty response from mistralText:', { model: MISTRAL_MODEL })
       return null
     }
     return text.trim()
   } catch (e: any) {
     console.error('[mistral] ✗ error in mistralText:', {
       message: e?.message, name: e?.name,
       stack: e?.stack?.split('\n').slice(0, 3), model: MISTRAL_MODEL,
     })
     return null
   }
}

/** Extract plain text from a PDF stored as a base64 string (briefs are usually
 *  text-based). Returns null for scanned/image-only PDFs or on failure. */
export async function extractPdfText(b64: string): Promise<string | null> {
  try {
    const buf = Buffer.from(b64, 'base64')
    const { text } = await extractText(new Uint8Array(buf), { mergePages: true })
    return (typeof text === 'string' ? text : (text as string[]).join('\n')).trim() || null
  } catch {
    return null
  }
}
