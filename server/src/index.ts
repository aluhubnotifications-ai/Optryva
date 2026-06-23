import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { initSchema, sb } from '@/db'
import { auth } from '@/routes/auth'
import { profiles } from '@/routes/profiles'
import { jobs } from '@/routes/jobs'
import { applications } from '@/routes/applications'
import { ai } from '@/routes/ai'
import { social, notifications, messages } from '@/routes/social'
import { hasClaude } from '@/lib/claude'

// Verify the Supabase connection at boot. Schema + seed live in
// server/supabase/init.sql (run once in the Supabase SQL Editor).
await initSchema()
const { count } = await sb.from('profiles').select('id', { count: 'exact', head: true })
if (!count) {
  console.warn('⚠️  No profiles found — run server/supabase/init.sql in your Supabase SQL Editor to create + seed the tables.')
}

const app = express()
// Allow the configured client origin, and any localhost port in dev (Vite may
// use 5173/5174/…). credentials:true so the refresh-token cookie flows.
const allowedOrigin = process.env.CLIENT_ORIGIN
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true) // curl/server-to-server
    if (allowedOrigin && origin === allowedOrigin) return cb(null, true)
    if (/^http:\/\/localhost:\d+$/.test(origin)) return cb(null, true)
    cb(new Error(`CORS: origin ${origin} not allowed`))
  },
  credentials: true,
}))
// Applications can carry several base64-encoded documents (CV, transcript,
// portfolio…) inline, plus avatar/cover uploads — so allow a generous body.
app.use(express.json({ limit: '25mb' }))
app.use(cookieParser())

app.get('/api/health', (_req, res) => res.json({ ok: true, claude: hasClaude() }))
app.use('/api/auth', auth)
app.use('/api/profiles', profiles)
app.use('/api/jobs', jobs)
app.use('/api/applications', applications)
app.use('/api/ai', ai)
app.use('/api/social', social)
app.use('/api/notifications', notifications)
app.use('/api/messages', messages)

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err)
  res.status(500).json({ error: 'server_error' })
})

const PORT = Number(process.env.PORT ?? 4000)
app.listen(PORT, () => {
  console.log(`Optryva API on http://localhost:${PORT}  (Claude: ${hasClaude() ? 'on' : 'fallback'})`)
})
