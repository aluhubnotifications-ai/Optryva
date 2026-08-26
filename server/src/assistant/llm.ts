/**
 * LLM abstraction layer for the Optryva Assistant.
 *
 * All assistant modules (engine, agent, tools) import from HERE — never
 * from @/lib/claude or @/lib/mistral directly. To switch providers, change
 * ONLY this file.
 *
 * Primary: Mistral (JSON-mode structured output, multi-turn support).
 * Fallback: Claude (structured output via output_config).
 *
 * The interface is intentionally minimal — just what the assistant needs:
 *  - hasAI()     — is any provider configured?
 *  - model()     — which model string is active?
 *  - PROVIDER    — which provider is active (for logging/debugging)
 *  - generateStructured  — single-turn, returns typed JSON
 *  - generateTurn        — multi-turn agentic loop, returns typed JSON
 *  - generateText        — single-turn plain text (used by tools)
 */
import { mistralChat, mistralText } from '@/lib/mistral'
import { claudeJson, claudeText, hasClaude, MODELS } from '@/lib/claude'

export enum Provider {
  Mistral = 'mistral',
  Claude = 'claude',
}

const mistralAvailable = (() => {
  try { return !!process.env.MISTRAL_API_KEY } catch { return false }
})()

/** Returns the active provider, or null if none configured. */
export function getProvider(): Provider | null {
  if (mistralAvailable) return Provider.Mistral
  if (hasClaude()) return Provider.Claude
  return null
}

/** Whether any AI provider is configured. */
export function hasAI(): boolean {
  return getProvider() !== null
}

/** Human-readable model name for the active provider. */
export function model(): string {
  if (mistralAvailable) return process.env.MISTRAL_MODEL || 'mistral-large-latest'
  return MODELS.chat
}

/**
 * Single-turn structured generation. Returns parsed JSON matching `schema`,
 * or null if no provider is available.
 */
export async function generateStructured<T>(opts: {
  system: string
  user: string
  schema?: unknown
  maxTokens?: number
  temperature?: number
}): Promise<T | null> {
  // --- Mistral (primary) ---
  if (mistralAvailable) {
    const result = await mistralChat<T>({
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
      schema: opts.schema,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
    })
    if (result) return result
  }

  // --- Claude (fallback) ---
  if (hasClaude()) {
    return claudeJson<T>({
      model: MODELS.chat,
      system: opts.system,
      user: opts.user,
      schema: opts.schema ?? { type: 'object' },
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
    })
  }

  return null
}

/** Conversation message for the agentic loop. */
export interface TurnMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Multi-turn agentic generation. Accepts a conversation history (user + assistant
 * turns) and returns structured JSON. Used by the agent loop where tool results
 * are fed back between turns.
 */
export async function generateTurn<T>(opts: {
  system: string
  messages: TurnMessage[]
  schema?: unknown
  maxTokens?: number
}): Promise<T | null> {
  if (mistralAvailable) {
    return mistralChat<T>({
      system: opts.system,
      messages: opts.messages,
      schema: opts.schema,
      maxTokens: opts.maxTokens,
    })
  }

  if (hasClaude()) {
    // Claude doesn't expose a generic multi-turn JSON helper, so we fold the
    // conversation into the user prompt and use claudeJson.
    const history = opts.messages
      .map((m) => `[${m.role}] ${m.content}`)
      .join('\n\n')
    return claudeJson<T>({
      model: MODELS.chat,
      system: opts.system,
      user: history,
      schema: opts.schema ?? { type: 'object' },
      maxTokens: opts.maxTokens,
      thinking: true,
    })
  }

  return null
}

/**
 * Single-turn plain-text generation. Used by tools (e.g. deep_inspect) to
 * extract text from scraped content.
 */
export async function generateText(opts: {
  system: string
  user: string
  maxTokens?: number
}): Promise<string | null> {
  if (mistralAvailable) {
    return mistralText({ system: opts.system, user: opts.user, maxTokens: opts.maxTokens })
  }

  if (hasClaude()) {
    return claudeText({
      model: MODELS.score,
      system: opts.system,
      user: opts.user,
      maxTokens: opts.maxTokens,
    })
  }

  return null
}
