import crypto from 'node:crypto'
import { sb } from '@/db'

const TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function roleKey(role: string | undefined): string {
  return (role ?? '').trim()
}

function hashKey(company: string, role: string | undefined): string {
  const raw = `${company.toLowerCase().trim()}|${roleKey(role)}`
  return crypto.createHash('md5').update(raw).digest('hex')
}

/** Convert structured research JSON to Markdown text (mirrors client formatCompanyResearch). */
export function formatResearchToMarkdown(data: any): string {
  if (!data || typeof data !== 'object') return ''
  if (data.text && typeof data.text === 'string') return data.text
  const parts: string[] = []
  if (data.overview) parts.push(data.overview)
  if (data.culture) parts.push(`## Culture\n${data.culture}`)
  if (data.opportunity) parts.push(`## Opportunity\n${data.opportunity}`)
  if (data.red_flags && data.red_flags.length) parts.push(`## Red flags\n${data.red_flags.map((f: string) => `- ${f}`).join('\n')}`)
  if (data.questions && data.questions.length) parts.push(`## Questions to ask\n${data.questions.map((q: string) => `- ${q}`).join('\n')}`)
  if (data.verdict) parts.push(`## Verdict\n${data.verdict}`)
  return parts.join('\n\n')
}

interface CacheEntry {
  text: string
  json: any
  provider: string
}

/** In-memory L1 cache (warm Worker instance). TTL matches the DB expiry. */
const l1 = new Map<string, { text: string; json: any; provider: string; expires: number }>()

function l1Get(key: string): CacheEntry | null {
  const hit = l1.get(key)
  if (hit && hit.expires > Date.now()) return { text: hit.text, json: hit.json, provider: hit.provider }
  if (hit) l1.delete(key)
  return null
}

function l1Set(key: string, entry: CacheEntry): void {
  l1.set(key, { ...entry, expires: Date.now() + TTL_MS })
}

/** Look up cached research (L1 → DB). Returns null when missing or expired. */
export async function getCachedResearch(company: string, role: string | undefined): Promise<CacheEntry | null> {
  const key = hashKey(company, role)
  const l1hit = l1Get(key)
  if (l1hit) return l1hit

  try {
    const { data, error } = await sb
      .from('company_research_cache')
      .select('text,json,provider,expires_at')
      .eq('company_role_hash', key)
      .single()
    if (error || !data) return null
    if (new Date(data.expires_at).getTime() <= Date.now()) return null
    const entry: CacheEntry = { text: data.text, json: data.json, provider: data.provider }
    l1Set(key, entry)
    return entry
  } catch {
    return null
  }
}

/** Persist research result into the cache (L1 + DB). */
export async function setCachedResearch(
  company: string,
  role: string | undefined,
  text: string,
  json: any,
  provider: string,
): Promise<void> {
  const key = hashKey(company, role)
  l1Set(key, { text, json, provider })
  try {
    const expiresAt = new Date(Date.now() + TTL_MS).toISOString()
    await sb.from('company_research_cache').upsert({
      company_role_hash: key,
      company: company.toLowerCase().trim(),
      role: roleKey(role),
      text,
      json,
      provider,
      generated_at: new Date().toISOString(),
      expires_at: expiresAt,
    })
  } catch {
    // DB write is best-effort; L1 cache still serves this instance.
  }
}

/** Invalidate cache (used by the "Re-search" force flag is handled client-side,
 * this just clears a stale entry). */
export async function clearCachedResearch(company: string, role: string | undefined): Promise<void> {
  const key = hashKey(company, role)
  l1.delete(key)
  try {
    await sb.from('company_research_cache').delete().eq('company_role_hash', key)
  } catch {
    /* ignore */
  }
}
