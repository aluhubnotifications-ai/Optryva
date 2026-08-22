// ----------------------------------------------------------------------------
// AI usage metering — every Anthropic call records its token usage, attributed
// to the requesting user, so the app can show "usage of credits" per model.
//
// Attribution uses AsyncLocalStorage: the HTTP shim runs each request inside a
// usage context (`runWithUsageContext`), `requireAuth` stamps the user id into
// it, and the Claude wrappers call `recordUsage(model, res.usage)` — which reads
// the id off the context. Streaming calls capture the id up front (the stream
// body runs after the handler returns) and pass it explicitly.
//
// All writes are best-effort and degrade gracefully until migration 0015 adds
// the `ai_usage` table (matches the column-guard pattern used elsewhere).
// ----------------------------------------------------------------------------
import { AsyncLocalStorage } from 'node:async_hooks'
import { sb } from '@/db'
import { uid, now } from '@/lib/util'

interface UsageCtx {
  userId?: string
}

const store = new AsyncLocalStorage<UsageCtx>()

/** Run `fn` inside a fresh usage context (one per HTTP request). */
export function runWithUsageContext<T>(fn: () => T): T {
  return store.run({}, fn)
}

/** Attribute everything in the current context to this user (called by requireAuth). */
export function setUsageUser(userId: string): void {
  const s = store.getStore()
  if (s) s.userId = userId
}

/** The user id of the current context, or null (capture this before streaming). */
export function currentUsageUserId(): string | null {
  return store.getStore()?.userId ?? null
}

/** Per-model price in USD per 1M tokens (input / output). Update on model swaps;
 *  unknown models price at 0 so cost is honest rather than guessed. */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'mistral-large-latest': { input: 2, output: 6 },
  'pixtral-large-latest': { input: 2, output: 6 },
}

// 1 credit = $0.01 of model spend — a single unit users can read across models
// that have very different per-token prices.
const USD_PER_CREDIT = 0.01

let usageTableOk: boolean | null = null
async function usageTableExists(): Promise<boolean> {
  if (usageTableOk !== null) return usageTableOk
  const { error } = await sb.from('ai_usage').select('id').limit(1)
  usageTableOk = !error
  return usageTableOk
}

/** Record one call's token usage. Best-effort and non-blocking — never throws,
 *  never delays the response. `userId` overrides the context (for streaming). */
export function recordUsage(model: string, usage: any, userId?: string | null): void {
  if (!usage) return
  const attributed = userId !== undefined ? userId : currentUsageUserId()
  const row = {
    id: uid('use'),
    user_id: attributed,
    model,
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_read_tokens: usage.cache_read_input_tokens ?? 0,
    cache_creation_tokens: usage.cache_creation_input_tokens ?? 0,
    created_at: now(),
  }
  void (async () => {
    if (!(await usageTableExists())) return
    await sb.from('ai_usage').insert(row)
  })().catch(() => {})
}

export interface ModelUsage {
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  calls: number
  cost_usd: number
  credits: number
}

export interface UsageSummary {
  available: boolean
  models: ModelUsage[]
  totals: { input_tokens: number; output_tokens: number; calls: number; cost_usd: number; credits: number }
}

const creditsOf = (usd: number) => Math.round(usd / USD_PER_CREDIT)

/** Aggregate a user's recorded usage per model, priced into USD and credits. */
export async function getUsageSummary(userId: string): Promise<UsageSummary> {
  const empty = { available: false, models: [], totals: { input_tokens: 0, output_tokens: 0, calls: 0, cost_usd: 0, credits: 0 } }
  if (!(await usageTableExists())) return empty
  const rows = ((await sb.from('ai_usage').select('model,input_tokens,output_tokens,cache_read_tokens').eq('user_id', userId)).data ?? []) as any[]

  const byModel = new Map<string, ModelUsage>()
  for (const r of rows) {
    const m = byModel.get(r.model) ?? { model: r.model, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, calls: 0, cost_usd: 0, credits: 0 }
    m.input_tokens += r.input_tokens ?? 0
    m.output_tokens += r.output_tokens ?? 0
    m.cache_read_tokens += r.cache_read_tokens ?? 0
    m.calls += 1
    byModel.set(r.model, m)
  }

  const models = [...byModel.values()].map((m) => {
    const p = MODEL_PRICING[m.model] ?? { input: 0, output: 0 }
    m.cost_usd = (m.input_tokens / 1e6) * p.input + (m.output_tokens / 1e6) * p.output
    m.credits = creditsOf(m.cost_usd)
    return m
  }).sort((a, b) => b.cost_usd - a.cost_usd)

  const totals = models.reduce(
    (t, m) => ({
      input_tokens: t.input_tokens + m.input_tokens,
      output_tokens: t.output_tokens + m.output_tokens,
      calls: t.calls + m.calls,
      cost_usd: t.cost_usd + m.cost_usd,
      credits: 0,
    }),
    { input_tokens: 0, output_tokens: 0, calls: 0, cost_usd: 0, credits: 0 },
  )
  totals.credits = creditsOf(totals.cost_usd)
  return { available: true, models, totals }
}

export interface UserUsage {
  user_id: string
  input_tokens: number
  output_tokens: number
  calls: number
  cost_usd: number
  credits: number
}

/** Admin view: usage aggregated per user AND overall per model. */
export async function getUsageByUser(): Promise<{
  available: boolean
  byUser: Record<string, UserUsage>
  models: ModelUsage[]
  totals: UsageSummary['totals']
}> {
  const empty = { available: false, byUser: {}, models: [], totals: { input_tokens: 0, output_tokens: 0, calls: 0, cost_usd: 0, credits: 0 } }
  if (!(await usageTableExists())) return empty
  const rows = ((await sb.from('ai_usage').select('user_id,model,input_tokens,output_tokens')).data ?? []) as any[]

  const byUser: Record<string, UserUsage> = {}
  const byModel = new Map<string, ModelUsage>()
  for (const r of rows) {
    const p = MODEL_PRICING[r.model] ?? { input: 0, output: 0 }
    const cost = ((r.input_tokens ?? 0) / 1e6) * p.input + ((r.output_tokens ?? 0) / 1e6) * p.output
    const key = r.user_id ?? 'unknown'
    const u = byUser[key] ?? { user_id: key, input_tokens: 0, output_tokens: 0, calls: 0, cost_usd: 0, credits: 0 }
    u.input_tokens += r.input_tokens ?? 0
    u.output_tokens += r.output_tokens ?? 0
    u.calls += 1
    u.cost_usd += cost
    byUser[key] = u
    const m = byModel.get(r.model) ?? { model: r.model, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, calls: 0, cost_usd: 0, credits: 0 }
    m.input_tokens += r.input_tokens ?? 0
    m.output_tokens += r.output_tokens ?? 0
    m.calls += 1
    m.cost_usd += cost
    byModel.set(r.model, m)
  }

  for (const u of Object.values(byUser)) u.credits = creditsOf(u.cost_usd)
  const models = [...byModel.values()].map((m) => { m.credits = creditsOf(m.cost_usd); return m }).sort((a, b) => b.cost_usd - a.cost_usd)
  const totals = models.reduce(
    (t, m) => ({ input_tokens: t.input_tokens + m.input_tokens, output_tokens: t.output_tokens + m.output_tokens, calls: t.calls + m.calls, cost_usd: t.cost_usd + m.cost_usd, credits: 0 }),
    { input_tokens: 0, output_tokens: 0, calls: 0, cost_usd: 0, credits: 0 },
  )
  totals.credits = creditsOf(totals.cost_usd)
  return { available: true, byUser, models, totals }
}
