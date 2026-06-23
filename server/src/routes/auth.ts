import { Router } from '@/lib/http'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { sb, must } from '@/db'
import { uid, now } from '@/lib/util'
import { requireAuth, signAccess, signRefresh, verifyRefresh, type AuthUser } from '@/lib/auth'
import { rowToProfile } from '@/lib/serialize'

export const auth = Router()

const REFRESH_COOKIE = 'optryva_rt'
const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: false,
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: '/',
}

async function authUserFrom(id: string): Promise<AuthUser> {
  return must(await sb.from('profiles').select('id, email, user_type').eq('id', id).maybeSingle()) as AuthUser
}

const registerSchema = z.object({
  full_name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  user_type: z.enum(['student', 'company', 'school']).default('student'),
})

auth.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid', details: parsed.error.flatten() })
  const { full_name, email, password, user_type } = parsed.data

  const exists = must(await sb.from('app_users').select('id').eq('email', email).maybeSingle())
  if (exists) return res.status(409).json({ error: 'email_taken' })

  const id = uid('u')
  const hash = await bcrypt.hash(password, 12)
  const ts = now()
  must(await sb.from('app_users').insert({ id, email, password_hash: hash, email_verified: 1, created_at: ts }))
  must(await sb.from('profiles').insert({
    id, user_type, full_name, email,
    company_name: user_type === 'student' ? null : full_name,
    posted_by_role: user_type === 'school' ? 'school' : 'company',
    plan: 'free', created_at: ts,
  }))

  const user = await authUserFrom(id)
  res.cookie(REFRESH_COOKIE, signRefresh(user), cookieOpts)
  const profile = must(await sb.from('profiles').select('*').eq('id', id).maybeSingle())
  res.json({ accessToken: signAccess(user), user: rowToProfile(profile) })
})

auth.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {}
  if (!email || !password) return res.status(400).json({ error: 'invalid' })
  const u = must(await sb.from('app_users').select('*').eq('email', email).maybeSingle()) as any
  if (!u || !(await bcrypt.compare(password, u.password_hash))) return res.status(401).json({ error: 'bad_credentials' })
  const user = await authUserFrom(u.id)
  res.cookie(REFRESH_COOKIE, signRefresh(user), cookieOpts)
  const profile = must(await sb.from('profiles').select('*').eq('id', u.id).maybeSingle())
  res.json({ accessToken: signAccess(user), user: rowToProfile(profile) })
})

auth.post('/refresh', async (req, res) => {
  const rt = req.cookies?.[REFRESH_COOKIE]
  const payload = rt ? verifyRefresh(rt) : null
  if (!payload) return res.status(401).json({ error: 'no_refresh' })
  const user = await authUserFrom(payload.id)
  if (!user) return res.status(401).json({ error: 'gone' })
  res.cookie(REFRESH_COOKIE, signRefresh(user), cookieOpts)
  res.json({ accessToken: signAccess(user) })
})

auth.post('/logout', (_req, res) => {
  res.clearCookie(REFRESH_COOKIE, { path: '/' })
  res.json({ ok: true })
})

auth.get('/me', requireAuth, async (req, res) => {
  const p = must(await sb.from('profiles').select('*').eq('id', req.user!.id).maybeSingle())
  if (!p) return res.status(404).json({ error: 'not_found' })
  res.json(rowToProfile(p))
})

auth.post('/change-password', requireAuth, async (req, res) => {
  const { current, next } = req.body ?? {}
  if (!next || next.length < 6) return res.status(400).json({ error: 'invalid' })
  const u = must(await sb.from('app_users').select('*').eq('id', req.user!.id).maybeSingle()) as any
  if (!u || !(await bcrypt.compare(current ?? '', u.password_hash))) return res.status(401).json({ error: 'bad_current' })
  must(await sb.from('app_users').update({ password_hash: await bcrypt.hash(next, 12) }).eq('id', u.id))
  res.json({ ok: true })
})

auth.post('/delete-account', requireAuth, async (req, res) => {
  // Cascades via FK to profiles, jobs, applications, etc.
  must(await sb.from('app_users').delete().eq('id', req.user!.id))
  res.clearCookie(REFRESH_COOKIE, { path: '/' })
  res.json({ ok: true })
})
