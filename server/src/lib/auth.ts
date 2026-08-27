import jwt from 'jsonwebtoken'
import { sb, must } from '@/db'
import type { ShimReq, ShimRes, Next } from '@/lib/http'
import { setUsageUser } from '@/lib/usage'

function loadJwtSecret(name: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET', devFallback: string) {
  const secret = process.env[name]
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} must be configured in production`)
  }
  return devFallback
}

const ACCESS_SECRET = loadJwtSecret('JWT_ACCESS_SECRET', 'dev-access-secret')
const REFRESH_SECRET = loadJwtSecret('JWT_REFRESH_SECRET', 'dev-refresh-secret')
// The 15m access token is a SHORT-LIVED, silently-rotated bearer. It is NOT a
// logout timer: every 15m the client trades the httpOnly refresh cookie for a
// fresh access token, invisibly. Keep it short (XSS blast-radius is small).
const ACCESS_TTL = '15m'
// Session lifetime. The refresh token/cookie lives up to 5 days, so a user stays
// signed in for 5 days; only after 5d does `/auth/refresh` return 401 and the
// client log them out. Auth-cookie maxAge (lib/cookies.ts) and the client
// watchdog (client/src/lib/store.ts) must match this.
const REFRESH_TTL = '5d'

export interface AuthUser {
  id: string
  email: string
  user_type: string
}

export function signAccess(u: AuthUser) {
  return jwt.sign(u, ACCESS_SECRET, { expiresIn: ACCESS_TTL })
}
export function signRefresh(u: AuthUser) {
  return jwt.sign({ id: u.id }, REFRESH_SECRET, { expiresIn: REFRESH_TTL })
}
export function verifyAccess(token: string): AuthUser | null {
  try {
    return jwt.verify(token, ACCESS_SECRET) as AuthUser
  } catch {
    return null
  }
}
export function verifyRefresh(token: string): { id: string } | null {
  try {
    return jwt.verify(token, REFRESH_SECRET) as { id: string }
  } catch {
    return null
  }
}

/** Require a valid access token; populates req.user. */
export function requireAuth(req: ShimReq, res: ShimRes, next: Next) {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  const user = token ? verifyAccess(token) : null
  if (!user) return res.status(401).json({ error: 'unauthorized' })
  req.user = user
  setUsageUser(user.id) // attribute this request's AI usage to the caller
  next()
}

/** Look up the freshest user_type from the DB (role may have changed). */
export async function loadUserType(id: string): Promise<string | null> {
  const row = must(await sb.from('profiles').select('user_type').eq('id', id).maybeSingle()) as { user_type: string } | null
  return row?.user_type ?? null
}
