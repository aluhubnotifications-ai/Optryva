// Shared Hono app — the API surface. Used by both the Cloudflare Worker
// (worker.ts) and the local Node dev server (index.ts).
//
// Only /api/* reaches this Worker in production: wrangler's
// `assets.run_worker_first: ["/api/*"]` routes API calls here and serves the
// built client (client/dist) for everything else, with SPA fallback. Because
// client and API share one origin, there is no CORS in production and the
// refresh-token cookie is same-site. CORS below only matters for cross-origin
// local dev (Vite on :5173 → wrangler/node API on another port).

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth } from '@/routes/auth'
import { profiles } from '@/routes/profiles'
import { jobs } from '@/routes/jobs'
import { applications } from '@/routes/applications'
import { ai } from '@/routes/ai'
import { social, notifications, messages } from '@/routes/social'
import { hasClaude } from '@/lib/claude'

export const app = new Hono()

app.use('/api/*', cors({
  origin: (origin) => {
    if (!origin) return origin // same-origin / curl — nothing to allow
    const allowed = process.env.CLIENT_ORIGIN
    if (allowed && origin === allowed) return origin
    if (/^https?:\/\/localhost:\d+$/.test(origin)) return origin
    return null
  },
  credentials: true,
}))

app.get('/api/health', (c) => c.json({ ok: true, claude: hasClaude() }))
app.route('/api/auth', auth.hono)
app.route('/api/profiles', profiles.hono)
app.route('/api/jobs', jobs.hono)
app.route('/api/applications', applications.hono)
app.route('/api/ai', ai.hono)
app.route('/api/social', social.hono)
app.route('/api/notifications', notifications.hono)
app.route('/api/messages', messages.hono)

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'server_error' }, 500)
})
