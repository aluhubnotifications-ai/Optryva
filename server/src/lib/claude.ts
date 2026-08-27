import Anthropic from '@anthropic-ai/sdk'
import { unzipSync, strFromU8 } from 'fflate'
import { recordUsage, currentUsageUserId } from '@/lib/usage'

// Centralized model config (spec §8): Opus for open-ended chat/coaching/research
// (with adaptive thinking), a cheap tier for high-volume scoring. Swap here to
// retarget everything. Model IDs verified against the current Anthropic catalog.
export const MODELS = {
  chat: 'claude-opus-4-8',
  coach: 'claude-opus-4-8',
  // Research uses live web search and runs interactively — Sonnet is much faster
  // (and cheaper) than Opus while still strong, so answers feel snappy.
  research: 'claude-sonnet-4-6',
  // The match score is the most consequential judgment in the product (it decides
  // who applies where), so it runs on Sonnet — strong evidence-weighing reasoning,
  // still fast. Caching + temperature 0 keep it cheap on repeat.
  match: 'claude-sonnet-4-6',
  // Cheap tier for high-volume, low-stakes generation (do-next, interview turns).
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
    recordUsage(params.model, res.usage)
    if (res.stop_reason === 'refusal') {
      console.warn('[claude] ⚠ Claude refused text request:', { model: params.model })
      return null
    }
    return (res.content as Anthropic.ContentBlock[])
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
   } catch (e: any) {
    console.error('[claude] ✗ error in claudeText:', {
      message: e?.message,
      name: e?.name,
      status: e?.status ?? e?.response?.status,
      stack: e?.stack?.split('\n').slice(0, 5),
      model: opts.model ?? MODELS.chat,
    })
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
    recordUsage(params.model, res.usage)
    if (res.stop_reason === 'refusal') {
      console.warn('[claude] ⚠ Claude refused to respond:', { model: params.model })
      return null
    }
    const text = (res.content ?? [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
    if (!text) {
      console.warn('[claude] ⚠ empty response from claudeJson:', { model: params.model, stop_reason: res.stop_reason })
      return null
    }
    try {
      return JSON.parse(text) as T
    } catch {
      console.warn('[claude] ⚠ claudeJson response not valid JSON, using extractJson fallback:', text.slice(0, 200))
      return extractJson<T>(text)
    }
  } catch (e: any) {
    console.error('[claude] ✗ error in claudeJson:', {
      message: e?.message,
      name: e?.name,
      status: e?.status ?? e?.response?.status,
      stack: e?.stack?.split('\n').slice(0, 5),
      model: opts.model ?? MODELS.chat,
    })
    return null
  }
}

/**
 * Like `claudeJson` but the user turn is a full content-block array, so callers
 * can pass multimodal input (images, PDFs, extracted text) for document-aware
 * generation — e.g. an employer uploads a brief and Claude designs questions
 * grounded in it. Returns the parsed object, or null on any failure.
 */
export async function claudeJsonBlocks<T>(opts: {
  model?: string
  system: string | SystemBlock[]
  content: any[]
  schema: unknown
  maxTokens?: number
  thinking?: boolean
  temperature?: number
}): Promise<T | null> {
  if (!client) return null
  try {
    const params: any = {
      model: opts.model ?? MODELS.score,
      max_tokens: opts.maxTokens ?? 1200,
      system: opts.system,
      output_config: { format: { type: 'json_schema', schema: opts.schema } },
      messages: [{ role: 'user', content: opts.content }],
    }
    if (opts.temperature != null) params.temperature = opts.temperature
    if (opts.thinking) params.thinking = { type: 'adaptive' }
    const res: any = await client!.messages.create(params)
    recordUsage(params.model, res.usage)
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

/** Parse a `data:<mime>;base64,<data>` URL into its parts (or null). */
export function parseDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
  if (!m) return null
  return { mediaType: m[1], data: m[2] }
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
    recordUsage(params.model, res.usage)
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
  const model = opts.model ?? MODELS.chat
  // The stream body runs after the request handler returns (outside the usage
  // context), so capture the attributed user id now and pass it explicitly.
  const usageUser = currentUsageUserId()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`))
      if (opts.meta !== undefined) send({ meta: opts.meta })
      const usage: any = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
      try {
        const params: any = {
          model,
          max_tokens: opts.maxTokens ?? 1024,
          system: opts.system,
          messages: [{ role: 'user', content: opts.user }],
          stream: true,
        }
        if (opts.tools) params.tools = opts.tools
        const stream: any = await client.messages.create(params)
        let any = false
        for await (const ev of stream) {
          if (ev?.type === 'message_start' && ev.message?.usage) Object.assign(usage, ev.message.usage)
          if (ev?.type === 'message_delta' && ev.usage?.output_tokens != null) usage.output_tokens = ev.usage.output_tokens
          if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
            any = true
            send({ t: ev.delta.text })
          }
        }
        send({ done: true, empty: !any })
      } catch {
        send({ error: true })
      } finally {
        recordUsage(model, usage, usageUser)
        controller.close()
      }
    },
  })
}

/** Extract readable text from a .docx (a ZIP of XML) — word/document.xml holds
 *  the body; text lives in <w:t> runs, paragraphs in <w:p>. No API call. */
export function extractDocxText(data: string): string | null {
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
 * Universal local document text extractor.
 * Handles PDF, DOCX, PPTX, DOC, RTF, HTML, CSV, JSON, XML, and plain text —
 * all locally without any API key. Falls back to Claude's document API for
 * PDFs that can't be parsed locally (e.g. image-only/scanned PDFs).
 *
 * Returns the extracted text, or null if the format is unsupported.
 */
export async function extractAnyDocumentText(dataUrl: string): Promise<string | null> {
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/s)
  if (!m) return null
  const mediaType = m[1].toLowerCase()
  const data = m[2]

  // Text-based formats — decode directly
  if (mediaType.startsWith('text/') || mediaType === 'application/json' || mediaType === 'application/xml' || mediaType === 'application/javascript') {
    try {
      const text = Buffer.from(data, 'base64').toString('utf-8').trim()
      if (text) return text
    } catch {}
    return null
  }

  const looksLikeZip = /^UEsDB/.test(data) // base64 of "PK\x03\x04"

  // PDF
  if (mediaType === 'application/pdf') {
    const { extractPdfText } = await import('@/lib/mistral')
    const text = await extractPdfText(data)
    if (text) return text
    // If local extraction fails and Claude is available, try Claude's PDF support
    if (client) {
      try {
        const res: any = await client.messages.create({
          model: MODELS.score,
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } },
              { type: 'text', text: 'Output ONLY the full plain text of this document — keep structure, omit nothing.' },
            ],
          }],
        })
        const text = (res.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim()
        if (text) return text
      } catch {}
    }
    return null
  }

  // DOCX / OOXML (also catches PPTX, XLSX via zip detection)
  if (looksLikeZip) {
    try {
      const files = unzipSync(new Uint8Array(Buffer.from(data, 'base64')))

      // DOCX: word/document.xml
      if (files['word/document.xml']) {
        return extractDocxText(data)
      }

      // PPTX: ppt/slides/slide1.xml + ppt/slides/slideN.xml + ppt/notesSlides/notesSlideN.xml
      const pptxSlides = Object.keys(files).filter((f) => f.startsWith('ppt/slides/slide') && f.endsWith('.xml'))
      if (pptxSlides.length) {
        const slides = pptxSlides
          .sort((a, b) => {
            const na = parseInt(a.match(/slide(\d+)\.xml$/)?.[1] ?? '0')
            const nb = parseInt(b.match(/slide(\d+)\.xml$/)?.[1] ?? '0')
            return na - nb
          })
          .map((f) => {
            const xml = strFromU8(files[f])
            return extractTextFromPptxXml(xml)
          })
          .filter(Boolean)
          .join('\n\n---\n\n')
        if (slides) return slides
      }

      // XLSX: xlsx/sharedStrings.xml + xlsx/worksheets/sheetN.xml
      if (files['xl/sharedStrings.xml']) {
        const shared = strFromU8(files['xl/sharedStrings.xml'])
        const sharedStrings = (shared.match(/<t[^>]*>([^<]*)<\/t>/g) ?? []).map((t) =>
          t.replace(/<t[^>]*>/, '').replace(/<\/t>/, ''),
        )
        const sheetFiles = Object.keys(files).filter((f) => f.startsWith('xl/worksheets/sheet') && f.endsWith('.xml'))
        const rows: string[] = []
        for (const sf of sheetFiles.sort()) {
          const xml = strFromU8(files[sf])
          const cells = xml.match(/<c[^>]*r="[A-Z]+\d+"[^>]*t="s"[^>]*>([^<]*)<\/c>/g)
          if (cells) {
            for (const c of cells) {
              const idx = parseInt(c.match(/>(\d+)</)?.[1] ?? '0')
              if (sharedStrings[idx]) rows.push(sharedStrings[idx])
            }
          }
        }
        if (rows.length) return rows.join('\n')
      }

      // Generic: try extracting from any XML file inside the zip
      for (const key of Object.keys(files)) {
        if (key.endsWith('.xml') && !key.startsWith('xl/meta') && !key.includes('theme')) {
          const xml = strFromU8(files[key])
          const text = xml.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s{2,}/g, ' ').trim()
          if (text && text.length > 20) return text.slice(0, 50000)
        }
      }
    } catch {}
    return null
  }

  // Legacy DOC (binary OLE Compound File) — check for OLE header
  if (/^D0CF11E0A1B11AE1/.test(data)) {
    // OLE2 compound document — try extracting text from WordDocument stream
    return extractTextFromOleDoc(data)
  }

  // RTF
  if (mediaType === 'application/rtf' || data.startsWith('e1xy')) {
    const text = Buffer.from(data, 'base64').toString('utf-8')
    return text.replace(/\{\\[^{}]*\}/g, '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim() || null
  }

  // HTML
  if (mediaType === 'text/html' || mediaType === 'application/xhtml+xml') {
    const html = Buffer.from(data, 'base64').toString('utf-8')
    const text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s{2,}/g, ' ').trim()
    return text || null
  }

  // Unknown format — try text decode as last resort
  try {
    const text = Buffer.from(data, 'base64').toString('utf-8').trim()
    if (text && text.length > 10 && /[a-zA-Z]/.test(text)) return text.slice(0, 10000)
  } catch {}

  return null
}

/** Extract text from a PPTX slide XML — handles <a:t> text elements. */
function extractTextFromPptxXml(xml: string): string {
  return (xml.match(/<a:t>([^<]*)<\/a:t>/g) ?? [])
    .map((t) => t.replace(/<a:t>/, '').replace(/<\/a:t>/, ''))
    .filter(Boolean)
    .join(' ')
}

/** Extract text from legacy DOC (OLE2 compound) — very basic support. */
function extractTextFromOleDoc(data: string): string | null {
  try {
    const buf = Buffer.from(data, 'base64')
    // Very rough: find ASCII text runs in the binary data
    let text = ''
    let current = ''
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i]
      if (b >= 0x20 && b <= 0x7e) {
        current += String.fromCharCode(b)
      } else {
        if (current.length > 10) text += current + '\n'
        current = ''
      }
    }
    if (current.length > 10) text += current
    return text.trim() || null
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
    recordUsage(MODELS.score, res.usage)
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
