// Shared Hono app — the API surface. Used by both the Cloudflare Worker
// (worker.ts) and the local Node dev server (index.ts).
//
// Split deploy: the client is a Cloudflare Pages site (optryva.pages.dev) and
// this Worker serves only /api/*. They're different origins, so the CORS rule
// below allows the Pages origin (CLIENT_ORIGIN + *.optryva.pages.dev previews)
// and localhost dev, and the refresh cookie is SameSite=None (see auth.ts).

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
    // Cloudflare Pages: production (optryva.pages.dev) and per-branch previews
    // (<hash>.optryva.pages.dev) all call this API Worker cross-origin.
    if (/^https:\/\/([a-z0-9-]+\.)?optryva\.pages\.dev$/.test(origin)) return origin
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
