import { Router } from '@/lib/http'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { sb, must } from '@/db'
import { uid, now } from '@/lib/util'
import { requireAuth, signAccess, signRefresh, verifyRefresh, type AuthUser } from '@/lib/auth'
import { rowToProfile } from '@/lib/serialize'

export const auth = Router()

// Interactive login must stay fast: bcryptjs is pure-JS (no native speedup), so
// cost 10 keeps the compare well under ~250ms while still meeting OWASP guidance.
const BCRYPT_COST = 10

const REFRESH_COOKIE = 'optryva_rt'
// Split deploy (client on Pages, API on a separate Worker) is cross-origin, so
// the browser only sends the refresh cookie when it's SameSite=None; Secure.
// Set COOKIE_SAMESITE=none on the API Worker for that. Same-origin deploys keep
// the simpler Lax cookie. (Secure is implied by None and by production.)
const CROSS_SITE = process.env.COOKIE_SAMESITE === 'none'
const cookieOpts = {
  httpOnly: true,
  sameSite: CROSS_SITE ? ('none' as const) : ('lax' as const),
  secure: CROSS_SITE || process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: '/',
}

async function authUserFromRow(p: any): Promise<AuthUser> {
  return { id: p.id, email: p.email, user_type: p.user_type } as AuthUser
}

// Fetch the full profile row once — reused to derive both the token subject and
// the response payload, so login/register don't pay for two profile queries.
async function fullProfile(id: string) {
  return must(await sb.from('profiles').select('*').eq('id', id).maybeSingle()) as any
}

// Backwards-compatible id-based lookup (still used by /refresh).
async function authUserFrom(id: string): Promise<AuthUser> {
  return authUserFromRow(await fullProfile(id))
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
  const hash = await bcrypt.hash(password, BCRYPT_COST)
  const ts = now()
  must(await sb.from('app_users').insert({ id, email, password_hash: hash, email_verified: 1, created_at: ts }))
  must(await sb.from('profiles').insert({
    id, user_type, full_name, email,
    company_name: user_type === 'student' ? null : full_name,
    posted_by_role: user_type === 'school' ? 'school' : 'company',
    plan: 'free', created_at: ts,
  }))

  const profile = await fullProfile(id)
  const user = await authUserFromRow(profile)
  res.cookie(REFRESH_COOKIE, signRefresh(user), cookieOpts)
  res.json({ accessToken: signAccess(user), user: rowToProfile(profile, true) })
})

auth.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {}
  if (!email || !password) return res.status(400).json({ error: 'invalid' })
  const u = must(await sb.from('app_users').select('*').eq('email', email).maybeSingle()) as any
  if (!u) return res.status(401).json({ error: 'bad_credentials' })
  // Google-only accounts have no password — send them to Google sign-in rather
  // than letting bcrypt.compare(password, null) throw an unhandled 500.
  if (!u.password_hash) return res.status(401).json({ error: 'account_google' })
  if (!(await bcrypt.compare(password, u.password_hash))) return res.status(401).json({ error: 'bad_credentials' })
  const profile = await fullProfile(u.id)
  const user = await authUserFromRow(profile)
  res.cookie(REFRESH_COOKIE, signRefresh(user), cookieOpts)
  res.json({ accessToken: signAccess(user), user: rowToProfile(profile, true) })
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
  res.json(rowToProfile(p, true))
})

auth.post('/change-password', requireAuth, async (req, res) => {
  const { current, next } = req.body ?? {}
  if (!next || next.length < 6) return res.status(400).json({ error: 'invalid' })
  const u = must(await sb.from('app_users').select('*').eq('id', req.user!.id).maybeSingle()) as any
  if (!u || !(await bcrypt.compare(current ?? '', u.password_hash))) return res.status(401).json({ error: 'bad_current' })
  must(await sb.from('app_users').update({ password_hash: await bcrypt.hash(next, BCRYPT_COST) }).eq('id', u.id))
  res.json({ ok: true })
})

auth.post('/delete-account', requireAuth, async (req, res) => {
  // Cascades via FK to profiles, jobs, applications, etc.
  must(await sb.from('app_users').delete().eq('id', req.user!.id))
  res.clearCookie(REFRESH_COOKIE, { path: '/' })
  res.json({ ok: true })
})

// Complete onboarding after role selection (called from RoleSelection page)
const completeOnboardingSchema = z.object({
  user_type: z.enum(['student', 'company', 'school']),
  returnTo: z.string().optional(),
})

auth.post('/complete-onboarding', requireAuth, async (req, res) => {
  const parsed = completeOnboardingSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid', details: parsed.error.flatten() })
  const { user_type } = parsed.data
  
  const id = req.user!.id
  const ts = now()
  
  // Update profile with selected role
  const updateData: any = { user_type }
  if (user_type === 'company') updateData.company_name = updateData.company_name ?? 'Your Company'
  if (user_type === 'school') updateData.posted_by_role = 'school'
  
  must(await sb.from('profiles').update(updateData).eq('id', id))
  
  // Update onboarding progress
  must(await sb.from('onboarding_progress').upsert({
    account_id: id,
    role: user_type,
    current_step: 1,
    completed_steps: 0,
    skipped_steps: '[]',
    updated_at: ts,
  }, { onConflict: 'account_id' }))
  
  // If student, create first resume profile
  if (user_type === 'student') {
    const existing = await sb.from('resume_profiles').select('id').eq('student_id', id).maybeSingle()
    if (!existing.data?.length) {
      await sb.from('resume_profiles').insert({
        id: uid('rp'),
        student_id: id,
        name: 'Primary',
        target_roles: '[]',
        preferred_industries: '[]',
        pref_countries: '[]',
        pref_listing_types: '[]',
        skills: '[]',
        work_type: 'any',
        active: 1,
        created_at: ts,
        updated_at: ts,
      })
    }
  }
  
  const profile = await fullProfile(id)
  const user = await authUserFromRow(profile)
  res.json({ accessToken: signAccess(user), user: rowToProfile(profile, true) })
})
