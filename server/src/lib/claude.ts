import Anthropic from '@anthropic-ai/sdk'
import { unzipSync, strFromU8 } from 'fflate'

// Centralized model config (spec §8): Opus for open-ended chat/coaching/research
// (with adaptive thinking), a cheap tier for high-volume scoring. Swap here to
// retarget everything. Model IDs verified against the current Anthropic catalog.
export const MODELS = {
  chat: 'claude-opus-4-8',
  coach: 'claude-opus-4-8',
  // Research uses live web search and runs interactively — Sonnet is much faster
  // (and cheaper) than Opus while still strong, so answers feel snappy.
  research: 'claude-sonnet-4-6',
  score: 'claude-haiku-4-5',
} as const

export function hasClaude() {
  return !!process.env.ANTHROPIC_API_KEY
}

const client = hasClaude() ? new Anthropic() : null
export { client as anthropic }

/**
 * messages.create with a small backoff on 429s. The account's Haiku tier is only
 * 5 req/min, so a brief retry keeps single interactive calls (chat, research,
 * do-next, compass) from failing under bursty load. Bulk scoring deliberately
 * does NOT use this (it's cache-backed + nightly-batched) to stay fast.
 */
async function createWithRetry(params: any, tries = 3): Promise<any> {
  let delay = 1500
  for (let i = 0; ; i++) {
    try {
      return await client!.messages.create(params)
    } catch (e: any) {
      const status = e?.status ?? e?.response?.status
      if (status === 429 && i < tries - 1) {
        await new Promise((r) => setTimeout(r, delay))
        delay *= 2
        continue
      }
      throw e
    }
  }
}

type SystemBlock = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }

/**
 * Single text completion. `system` may be a plain string or an array of blocks
 * (so callers can attach cache_control for prompt caching). Returns the
 * assistant text, or null on any failure (no key, network, refusal).
 */
export async function claudeText(opts: {
  model?: string
  system: string | SystemBlock[]
  user: string
  maxTokens?: number
  thinking?: boolean
}): Promise<string | null> {
  if (!client) return null
  try {
    const params: any = {
      model: opts.model ?? MODELS.chat,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
    }
    if (opts.thinking) params.thinking = { type: 'adaptive' }
    const res = await createWithRetry(params)
    if (res.stop_reason === 'refusal') return null
    return (res.content as Anthropic.ContentBlock[])
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
  } catch {
    return null
  }
}

/**
 * Structured completion: constrains the model to a JSON schema (output_config),
 * supports a cached system prefix, and optional adaptive thinking. Returns the
 * parsed object, or null on any failure so callers fall back to the
 * deterministic engine. This is what makes scores reliably shaped AND honest:
 * the schema can't be talked around and there's nothing to mis-parse.
 */
export async function claudeJson<T>(opts: {
  model?: string
  system: string | SystemBlock[]
  user: string
  schema: unknown
  maxTokens?: number
  thinking?: boolean
  /** Sampling temperature. Pass 0 for stable, repeatable scores (the matcher
   *  uses this so the same résumé+job yields the same number on re-score). */
  temperature?: number
}): Promise<T | null> {
  if (!client) return null
  try {
    const params: any = {
      model: opts.model ?? MODELS.score,
      max_tokens: opts.maxTokens ?? 800,
      system: opts.system,
      output_config: { format: { type: 'json_schema', schema: opts.schema } },
      messages: [{ role: 'user', content: opts.user }],
    }
    if (opts.temperature != null) params.temperature = opts.temperature
    if (opts.thinking) params.thinking = { type: 'adaptive' }
    const res: any = await client.messages.create(params)
    if (res.stop_reason === 'refusal') return null
    const text = (res.content ?? [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
    if (!text) return null
    try {
      return JSON.parse(text) as T
    } catch {
      return extractJson<T>(text)
    }
  } catch {
    return null
  }
}

/**
 * Text completion with the server-side web_search tool, so company/role research
 * is grounded in current information rather than stale model memory. Falls back
 * to plain text if the tool variant isn't available.
 */
export async function claudeTextWithSearch(opts: {
  model?: string
  system: string
  user: string
  maxTokens?: number
}): Promise<string | null> {
  if (!client) return null
  try {
    const params: any = {
      model: opts.model ?? MODELS.research,
      max_tokens: opts.maxTokens ?? 900,
      system: opts.system,
      tools: [{ type: 'web_search_20260209', name: 'web_search' }],
      messages: [{ role: 'user', content: opts.user }],
    }
    const res: any = await createWithRetry(params)
    if (res.stop_reason === 'refusal') return null
    const text = (res.content ?? [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim()
    return text || null
  } catch {
    // Older web_search variant or unsupported on the account — degrade to plain.
    return claudeText({ model: opts.model ?? MODELS.research, system: opts.system, user: opts.user, maxTokens: opts.maxTokens })
  }
}

/**
 * Streaming text completion → a Server-Sent-Events ReadableStream so the client
 * can render the answer token-by-token (it "shows progress like AI" instead of
 * waiting for the whole reply). Emits `data: {"t":"<delta>"}` per text chunk and
 * a final `data: {"done":true,"empty":<bool>}`; `data: {"error":true}` on
 * failure. Returns null when there's no key (caller should 503). Supports the
 * web_search tool so research streams live. Thinking deltas are intentionally
 * not forwarded — only the user-facing answer is streamed.
 */
export function streamClaude(opts: {
  model?: string
  system: string
  user: string
  maxTokens?: number
  tools?: unknown[]
  /** Optional metadata emitted as the first SSE frame: `data: {"meta":...}`. */
  meta?: unknown
}): ReadableStream<Uint8Array> | null {
  if (!client) return null
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`))
      if (opts.meta !== undefined) send({ meta: opts.meta })
      try {
        const params: any = {
          model: opts.model ?? MODELS.chat,
          max_tokens: opts.maxTokens ?? 1024,
          system: opts.system,
          messages: [{ role: 'user', content: opts.user }],
          stream: true,
        }
        if (opts.tools) params.tools = opts.tools
        const stream: any = await client.messages.create(params)
        let any = false
        for await (const ev of stream) {
          if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
            any = true
            send({ t: ev.delta.text })
          }
        }
        send({ done: true, empty: !any })
      } catch {
        send({ error: true })
      } finally {
        controller.close()
      }
    },
  })
}

/** Extract readable text from a .docx (a ZIP of XML) — word/document.xml holds
 *  the body; text lives in <w:t> runs, paragraphs in <w:p>. No API call. */
function extractDocxText(data: string): string | null {
  try {
    const files = unzipSync(new Uint8Array(Buffer.from(data, 'base64')))
    const doc = files['word/document.xml']
    if (!doc) return null
    const xml = strFromU8(doc)
    const text = xml
      .replace(/<w:p\b[^>]*>/g, '\n') // paragraph → newline
      .replace(/<w:tab\b[^>]*\/?>/g, '\t')
      .replace(/<[^>]+>/g, '') // drop all tags; only <w:t> runs carry text
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return text || null
  } catch {
    return null
  }
}

/**
 * Pull the plain text out of an uploaded résumé file stored as a data URL — so
 * the whole AI layer can read the candidate's actual CV regardless of format.
 * PDFs are read by Claude's native document support; .docx (Word) is unzipped
 * locally; text/* is decoded directly. Word files often arrive with a generic
 * MIME type, so ZIP-looking bytes (PK header) are treated as .docx too. Returns
 * null for unsupported types (e.g. legacy binary .doc) / no key / failure.
 */
export async function extractDocumentText(dataUrl: string): Promise<string | null> {
  if (!client || typeof dataUrl !== 'string') return null
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/s)
  if (!m) return null
  const mediaType = m[1]
  const data = m[2]
  if (mediaType.startsWith('text/')) {
    try {
      return Buffer.from(data, 'base64').toString('utf-8').trim() || null
    } catch {
      return null
    }
  }
  // .docx — explicit MIME, or a generic/octet-stream type whose bytes are a ZIP.
  const isDocxMime = mediaType.includes('officedocument.wordprocessingml') || mediaType === 'application/vnd.ms-word'
  const looksLikeZip = mediaType !== 'application/pdf' && /^UEsDB/.test(data) // base64 of "PK\x03\x04"
  if (isDocxMime || looksLikeZip) return extractDocxText(data)
  if (mediaType !== 'application/pdf') return null // legacy binary .doc and others are unsupported
  try {
    const res: any = await client.messages.create({
      model: MODELS.score,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } },
            { type: 'text', text: 'Output ONLY the full plain text of this résumé/CV — keep section headings and bullet points, omit nothing important. No commentary, no preamble.' },
          ],
        },
      ],
    })
    const text = (res.content ?? [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim()
    return text || null
  } catch {
    return null
  }
}

/** Parse a JSON object out of a model response, tolerating code fences/prose. */
export function extractJson<T>(text: string | null): T | null {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T
  } catch {
    return null
  }
}
