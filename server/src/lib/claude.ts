import Anthropic from '@anthropic-ai/sdk'

// Centralized model config (spec §8): Opus for open-ended chat/coaching/research
// (with adaptive thinking), a cheap tier for high-volume scoring. Swap here to
// retarget everything. Model IDs verified against the current Anthropic catalog.
export const MODELS = {
  chat: 'claude-opus-4-8',
  coach: 'claude-opus-4-8',
  research: 'claude-opus-4-8',
  score: 'claude-haiku-4-5',
} as const

export function hasClaude() {
  return !!process.env.ANTHROPIC_API_KEY
}

const client = hasClaude() ? new Anthropic() : null
export { client as anthropic }

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
    const res = await client.messages.create(params)
    if (res.stop_reason === 'refusal') return null
    return res.content
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
    const res: any = await client.messages.create(params)
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
