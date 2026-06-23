import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

// ----------------------------------------------------------------------------
// Supabase data layer (PostgREST over HTTPS — works on IPv4-only networks where
// a direct Postgres/pooler TCP connection isn't reachable).
//
// Routes use the `sb` query builder + the `must()` helper to unwrap results.
// `must({ data, error })` throws on error and returns `data`.
// ----------------------------------------------------------------------------

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  throw new Error(
    'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in server/.env ' +
      '(Supabase → Project Settings → API).',
  )
}

export const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** Unwrap a supabase result: throw on error, return data. */
export function must<T>(res: { data: T; error: any }): T {
  if (res.error) throw new Error(res.error.message ?? String(res.error))
  return res.data
}

/** Verify connectivity at boot. */
export async function initSchema() {
  const { error } = await sb.from('profiles').select('id', { head: true, count: 'exact' })
  if (error) throw new Error(`Supabase connection failed: ${error.message}`)
}

// JSON helpers (text columns hold JSON arrays/objects, same as before)
export const j = {
  parse<T>(s: string | null | undefined, fallback: T): T {
    if (!s) return fallback
    try {
      return JSON.parse(s) as T
    } catch {
      return fallback
    }
  },
  stringify(v: unknown): string {
    return JSON.stringify(v ?? null)
  },
}
