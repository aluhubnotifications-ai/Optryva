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
  console.log('[assistant:llm] generateStructured START', {
    provider: getProvider(),
    model: model(),
    maxTokens: opts.maxTokens ?? 1600,
    temperature: opts.temperature ?? 0.7,
    system_len: opts.system.length,
    user_len: opts.user.length,
    user_preview: opts.user.slice(0, 100),
  })
  // --- Mistral (primary) ---
  if (mistralAvailable) {
    console.log('[assistant:llm] → using Mistral (primary)')
    let result: T | null = null
    try {
      result = await mistralChat<T>({
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
        schema: opts.schema,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
      })
      if (result) {
        console.log('[assistant:llm] ✓ Mistral returned:', JSON.stringify(result).slice(0, 300))
      } else {
        console.warn('[assistant:llm] ⚠ Mistral returned null — falling through to Claude')
      }
    } catch (e: any) {
      console.error('[assistant:llm] ✗ Mistral error in generateStructured:', { message: e?.message, stack: e?.stack?.split('\n').slice(0, 3) })
    }
    if (result) return result
  }

  // --- Claude (fallback) ---
  if (hasClaude()) {
    console.log('[assistant:llm] → using Claude (fallback)')
    try {
      const result = await claudeJson<T>({
        model: MODELS.chat,
        system: opts.system,
        user: opts.user,
        schema: opts.schema ?? { type: 'object' },
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
      })
      console.log('[assistant:llm] ✓ Claude returned:', JSON.stringify(result).slice(0, 300))
      return result
    } catch (e: any) {
      console.error('[assistant:llm] ✗ Claude error in generateStructured:', { message: e?.message, stack: e?.stack?.split('\n').slice(0, 3) })
    }
  }

  console.error('[assistant:llm] ✗ generateStructured: NO PROVIDER AVAILABLE')
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
  console.log('[assistant:llm] generateTurn START', {
    provider: getProvider(),
    model: model(),
    maxTokens: opts.maxTokens ?? 1000,
    msg_count: opts.messages.length,
    msg_preview: opts.messages[0]?.content?.slice(0, 100),
  })

  if (mistralAvailable) {
    console.log('[assistant:llm] → using Mistral (primary, multi-turn)')
    try {
      const result = await mistralChat<T>({
        system: opts.system,
        messages: opts.messages,
        schema: opts.schema,
        maxTokens: opts.maxTokens,
      })
      if (result) {
        console.log('[assistant:llm] ✓ Mistral generateTurn returned:', JSON.stringify(result).slice(0, 300))
      } else {
        console.warn('[assistant:llm] ⚠ Mistral generateTurn returned null')
      }
      return result
    } catch (e: any) {
      console.error('[assistant:llm] ✗ Mistral error in generateTurn:', { message: e?.message, stack: e?.stack?.split('\n').slice(0, 3) })
    }
  }

  if (hasClaude()) {
    console.log('[assistant:llm] → using Claude (fallback, multi-turn)')
    try {
      // Claude doesn't expose a generic multi-turn JSON helper, so we fold the
      // conversation into the user prompt and use claudeJson.
      const history = opts.messages
        .map((m) => `[${m.role}] ${m.content}`)
        .join('\n\n')
      const result = await claudeJson<T>({
        model: MODELS.chat,
        system: opts.system,
        user: history,
        schema: opts.schema ?? { type: 'object' },
        maxTokens: opts.maxTokens,
        thinking: false,
      })
      console.log('[assistant:llm] ✓ Claude generateTurn returned:', JSON.stringify(result).slice(0, 300))
      return result
    } catch (e: any) {
      console.error('[assistant:llm] ✗ Claude error in generateTurn:', { message: e?.message, stack: e?.stack?.split('\n').slice(0, 3) })
    }
  }

  console.error('[assistant:llm] ✗ generateTurn: NO PROVIDER AVAILABLE')
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
  const provider = getProvider()
  console.log('[assistant:llm] generateText START', {
    provider,
    model: model(),
    maxTokens: opts.maxTokens ?? 1000,
    user_len: opts.user.length,
    user_preview: opts.user.slice(0, 100),
  })

  if (mistralAvailable) {
    console.log('[assistant:llm] → using Mistral (primary, text)')
    try {
      const result = await mistralText({ system: opts.system, user: opts.user, maxTokens: opts.maxTokens })
      console.log('[assistant:llm] ✓ Mistral generateText returned:', result?.slice(0, 200) ?? 'null')
      return result
    } catch (e: any) {
      console.error('[assistant:llm] ✗ Mistral error in generateText:', { message: e?.message, stack: e?.stack?.split('\n').slice(0, 3) })
    }
  }

  if (hasClaude()) {
    console.log('[assistant:llm] → using Claude (fallback, text)')
    try {
      const result = await claudeText({
        model: MODELS.score,
        system: opts.system,
        user: opts.user,
        maxTokens: opts.maxTokens,
      })
      console.log('[assistant:llm] ✓ Claude generateText returned:', result?.slice(0, 200) ?? 'null')
      return result
    } catch (e: any) {
      console.error('[assistant:llm] ✗ Claude error in generateText:', { message: e?.message, stack: e?.stack?.split('\n').slice(0, 3) })
    }
  }

  console.error('[assistant:llm] ✗ generateText: NO PROVIDER AVAILABLE')
  return null
}
