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

// Keep the pooled Supabase (PostgREST over HTTPS) connection warm. After ~60s of
// idle the pooler closes the connection and the next auth query pays a ~5s
// reconnect/TLS penalty — which is what made "login takes so long" after the dev
// server sat idle. A cheap read every 45s keeps the pool hot so login stays
// fast even after the server has been sitting unused. Only on Node (Workers
// reuse a fresh pool per invocation anyway); no-op if Supabase was unreachable.
if (supabaseReady) {
  setInterval(() => { void sb.from('profiles').select('id').limit(1).maybeSingle() }, 45_000)
}

const port = Number(process.env.PORT ?? 4000)
serve({ fetch: app.fetch, port }, () => {
  console.log(`Optryva API on http://localhost:${port}  (AI: ${hasAI() ? 'ready' : 'no-provider'})`)
})
