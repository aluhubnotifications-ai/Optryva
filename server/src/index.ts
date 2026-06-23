// Local Node dev server (`npm run dev`). Production runs on Cloudflare via
// worker.ts; this serves the same Hono `app` over Node for convenient local
// development with `tsx watch`.
import 'dotenv/config'
import { serve } from '@hono/node-server'
import { app } from '@/app'
import { sb } from '@/db'
import { hasClaude } from '@/lib/claude'

// Connectivity check at boot (Node only — Workers forbid I/O at global scope).
const { count, error } = await sb.from('profiles').select('id', { count: 'exact', head: true })
if (error) console.warn(`⚠️  Supabase check failed: ${error.message}`)
else if (!count) console.warn('⚠️  No profiles found — run server/supabase/init.sql in your Supabase SQL Editor to create + seed the tables.')

const port = Number(process.env.PORT ?? 4000)
serve({ fetch: app.fetch, port }, () => {
  console.log(`Optryva API on http://localhost:${port}  (Claude: ${hasClaude() ? 'on' : 'fallback'})`)
})
