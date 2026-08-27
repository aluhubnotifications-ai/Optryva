// Local Node dev server (`npm run dev`). Production runs on Cloudflare via
// worker.ts; this serves the same Hono `app` over Node for convenient local
// development with `tsx watch`.
import '@/loadenv' // MUST be first — loads .env with override before any module reads process.env
import { serve } from '@hono/node-server'
import { app } from '@/app'
import { sb } from '@/db'
import { hasAI } from '@/assistant/llm'

// Connectivity check at boot (Node only — Workers forbid I/O at global scope).
let supabaseReady = false
try {
  const { count, error } = await sb.from('profiles').select('id', { count: 'exact', head: true })
  if (error) console.warn(`⚠️  Supabase check failed: ${error.message}`)
  else if (!count) console.warn('⚠️  No profiles found — run server/supabase/init.sql in your Supabase SQL Editor to create + seed the tables.')
  else supabaseReady = true
} catch (e: any) {
  console.warn(`⚠️  Supabase unavailable — auth and DB routes will fail, but static/file routes work. (${e?.message ?? String(e)})`)
}

// Keep the pooled Supabase (PostgREST over HTTPS) connection warm. After the pooler
// idles out (~10–15s) the next auth query pays a ~5s reconnect penalty — the
// "login takes so long after the dev server sits idle" symptom. A cheap read
// every 8s (under the pooler's idle window) keeps the pool hot so login stays
// under ~2s even after the server has been sitting unused. No-op on Workers
// (fresh pool per invocation) and if Supabase was unreachable at boot. Only cold
// pings are logged so the warm ones stay silent.
if (supabaseReady) {
  // Immediate warmup: a real data SELECT touches the same PostgREST path login
  // uses, so the first request after boot (or after a tsx-watch restart) doesn't
  // pay the ~5s cold-reconnect penalty. Fire it at boot (non-blocking); the
  // interval below keeps the pool hot afterwards.
  void sb.from('profiles').select('id').limit(1).maybeSingle()
  setInterval(async () => {
    const t = Date.now()
    try { await sb.from('profiles').select('id').limit(1).maybeSingle() }
    catch { /* keepalive is best-effort */ }
    const ms = Date.now() - t
    if (ms > 1000) console.log(`[keepalive] supabase cold-ping in ${ms}ms`)
  }, 8_000)
}

const port = Number(process.env.PORT ?? 4000)
serve({ fetch: app.fetch, port }, () => {
  console.log(`Optryva API on http://localhost:${port}  (AI: ${hasAI() ? 'ready' : 'no-provider'})`)
})
