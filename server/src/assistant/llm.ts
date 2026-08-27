/**
 * LLM abstraction layer for the Optryva Assistant.
 *
 * All assistant modules (engine, agent, tools) import from HERE — never
 * from @/lib/claude or @/lib/mistral directly. To switch providers, change
 * ONLY this file.
 *
 * Primary (assistant only): Groq (OpenAI-compatible JSON-mode structured output).
 * Fallback: Mistral.
 *
 * The interface is intentionally minimal — just what the assistant needs:
 *  - hasAI()     — is any provider configured?
 *  - model()     — which model string is active?
 *  - getProvider — which provider is active (for logging/debugging)
 *  - generateStructured  — single-turn, returns typed JSON
 *  - generateTurn        — multi-turn agentic loop, returns typed JSON
 *  - generateText        — single-turn plain text (used by tools)
 */
import { groqChatJson, groqText, hasGroq, groqModel } from '@/lib/groq'
import { mistralChat, mistralText, hasMistral, MISTRAL_MODEL } from '@/lib/mistral'
import { claudeJson, claudeText, hasClaude, MODELS } from '@/lib/claude'

export enum Provider {
  Groq = 'groq',
  Mistral = 'mistral',
  Claude = 'claude',
}

const groqAvailable = (() => {
  try { return !!process.env.GROQ_API_KEY } catch { return false }
})()

/** Returns the active provider, or null if none configured. */
export function getProvider(): Provider | null {
  if (groqAvailable) return Provider.Groq
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
  if (groqAvailable) return groqModel()
  if (mistralAvailable) return process.env.MISTRAL_MODEL || MISTRAL_MODEL
  return MODELS.chat
}

const mistralAvailable = (() => {
  try { return !!process.env.MISTRAL_API_KEY } catch { return false }
})()

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

  // --- Groq (primary) ---
  if (groqAvailable) {
    console.log('[assistant:llm] → using Groq (primary)')
    let result: T | null = null
    try {
      result = await groqChatJson<T>({
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
        schema: opts.schema,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
      })
      if (result) {
        console.log('[assistant:llm] ✓ Groq returned:', JSON.stringify(result).slice(0, 300))
        const r = result as any
        if (typeof r.text !== 'string' && r.text !== undefined) {
          console.warn('[assistant:llm] ⚠ Groq returned object but "text" is not string:', typeof r.text)
        }
        if (result && !r.text && !r.actions) {
          console.warn('[assistant:llm] ⚠ Groq returned object without text or actions — may be malformed schema')
        }
      } else {
        console.warn('[assistant:llm] ⚠ Groq returned null — falling through to Mistral')
      }
    } catch (e: any) {
      console.error('[assistant:llm] ✗ Groq error in generateStructured:', { message: e?.message, stack: e?.stack?.split('\n').slice(0, 3) })
    }
    if (result) return result
  }

  // --- Mistral (fallback) ---
  if (mistralAvailable) {
    console.log('[assistant:llm] → using Mistral (fallback)')
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

  // --- Groq (primary) ---
  if (groqAvailable) {
    console.log('[assistant:llm] → using Groq (primary, multi-turn)')
    try {
      const result = await groqChatJson<T>({
        system: opts.system,
        messages: opts.messages,
        schema: opts.schema,
        maxTokens: opts.maxTokens,
      })
      if (result) {
        console.log('[assistant:llm] ✓ Groq generateTurn returned:', JSON.stringify(result).slice(0, 300))
      } else {
        console.warn('[assistant:llm] ⚠ Groq generateTurn returned null')
      }
      return result
    } catch (e: any) {
      console.error('[assistant:llm] ✗ Groq error in generateTurn:', { message: e?.message, stack: e?.stack?.split('\n').slice(0, 3) })
    }
  }

  // --- Mistral (fallback) ---
  if (mistralAvailable) {
    console.log('[assistant:llm] → using Mistral (fallback, multi-turn)')
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

  // --- Claude (fallback) ---
  if (hasClaude()) {
    console.log('[assistant:llm] → using Claude (fallback, multi-turn)')
    try {
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

  // --- Groq (primary) ---
  if (groqAvailable) {
    console.log('[assistant:llm] → using Groq (primary, text)')
    try {
      const result = await groqText({ system: opts.system, user: opts.user, maxTokens: opts.maxTokens })
      console.log('[assistant:llm] ✓ Groq generateText returned:', result?.slice(0, 200) ?? 'null')
      return result
    } catch (e: any) {
      console.error('[assistant:llm] ✗ Groq error in generateText:', { message: e?.message, stack: e?.stack?.split('\n').slice(0, 3) })
    }
  }

  // --- Mistral (fallback) ---
  if (mistralAvailable) {
    console.log('[assistant:llm] → using Mistral (fallback, text)')
    try {
      const result = await mistralText({ system: opts.system, user: opts.user, maxTokens: opts.maxTokens })
      console.log('[assistant:llm] ✓ Mistral generateText returned:', result?.slice(0, 200) ?? 'null')
      return result
    } catch (e: any) {
      console.error('[assistant:llm] ✗ Mistral error in generateText:', { message: e?.message, stack: e?.stack?.split('\n').slice(0, 3) })
    }
  }

  // --- Claude (fallback) ---
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
