// Local Node dev server (`npm run dev`). Production runs on Cloudflare via
// worker.ts; this serves the same Hono `app` over Node for convenient local
// development with `tsx watch`.
import '@/loadenv' // MUST be first — loads .env with override before any module reads process.env
import { serve } from '@hono/node-server'
import { app } from '@/app'
import { sb } from '@/db'
import { hasAI } from '@/assistant/llm'

// Connectivity check at boot (Node only — Workers forbid I/O at global scope).
try {
  const { count, error } = await sb.from('profiles').select('id', { count: 'exact', head: true })
  if (error) console.warn(`⚠️  Supabase check failed: ${error.message}`)
  else if (!count) console.warn('⚠️  No profiles found — run server/supabase/init.sql in your Supabase SQL Editor to create + seed the tables.')
} catch (e: any) {
  console.warn(`⚠️  Supabase unavailable — auth and DB routes will fail, but static/file routes work. (${e?.message ?? String(e)})`)
}

const port = Number(process.env.PORT ?? 4000)
serve({ fetch: app.fetch, port }, () => {
  console.log(`Optryva API on http://localhost:${port}  (AI: ${hasAI() ? 'ready' : 'no-provider'})`)
})
