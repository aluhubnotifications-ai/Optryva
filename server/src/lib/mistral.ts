import { recordUsage } from '@/lib/usage'
import { extractJson } from '@/lib/claude'

// ----------------------------------------------------------------------------
// Mistral AI client (assessment generation). Used as an alternative provider to
// Claude for designing candidate assignments. The smartest generally-available
// Mistral model is `mistral-large-latest`; override via MISTRAL_MODEL.
// ----------------------------------------------------------------------------

/** Mistral's top model. Can be overridden with the MISTRAL_MODEL env var. */
export const MISTRAL_MODEL = process.env.MISTRAL_MODEL || 'mistral-large-latest'

export function hasMistral(): boolean {
  return !!process.env.MISTRAL_API_KEY
}

const ENDPOINT = 'https://api.mistral.ai/v1/chat/completions'

/**
 * Core text→JSON call. Mistral's API supports a `json_object` response format
 * which reliably steers the model to emit parseable JSON (we also tolerate
 * fenced/prose output via `extractJson`). Returns the parsed object, or null on
 * any failure (no key, network, non-JSON) so callers can fall back.
 */
async function mistralJson<T>(opts: {
  model?: string
  system: string
  user: string
  maxTokens?: number
  temperature?: number
}): Promise<T | null> {
  if (!hasMistral()) return null
  const model = opts.model ?? MISTRAL_MODEL
  try {
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
          { role: 'user', content: opts.user },
        ],
        response_format: { type: 'json_object' },
        max_tokens: opts.maxTokens ?? 1200,
        ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      }),
    })
    if (!res.ok) return null
    const data: any = await res.json()
    const usage = data?.usage
    if (usage) {
      recordUsage(model, { input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0 })
    }
    const text: string | undefined = data?.choices?.[0]?.message?.content
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

/** Convert a Claude-style content block into plain text for a text-only model. */
function blockToText(block: any): string {
  if (!block) return ''
  if (block.type === 'text') return block.text ?? ''
  if (block.type === 'image') return '(An image was uploaded but this model cannot view images — design from the role context and any extracted text.)'
  if (block.type === 'document') return '(A document/PDF was uploaded but this model cannot read files — design from the role context and any extracted text.)'
  return ''
}

/**
 * Like `mistralJson` but the user turn is a content-block array (matching the
 * Claude wrappers) so callers can pass the same multimodal input. Mistral Large
 * is text-only, so images/PDFs are summarised as "not readable" notes; extracted
 * text and role context are passed through. `schema` is appended to the system
 * prompt as a shape hint (Mistral does not hard-enforce it).
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
  const userText = opts.content.map(blockToText).filter(Boolean).join('\n\n')
  if (!userText.trim()) return null
  const system = opts.schema
    ? `${opts.system}\n\nReturn ONLY valid JSON matching this schema (no prose, no code fences):\n${JSON.stringify(opts.schema)}`
    : opts.system
  return mistralJson<T>({ model: opts.model ?? MISTRAL_MODEL, system, user: userText, maxTokens: opts.maxTokens ?? 2000, temperature: opts.temperature })
}
