import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { sb, must } from '@/db'

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret'
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret'
const ACCESS_TTL = '15m'
const REFRESH_TTL = '30d'

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

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

/** Require a valid access token; populates req.user. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  const user = token ? verifyAccess(token) : null
  if (!user) return res.status(401).json({ error: 'unauthorized' })
  req.user = user
  next()
}

/** Look up the freshest user_type from the DB (role may have changed). */
export async function loadUserType(id: string): Promise<string | null> {
  const row = must(await sb.from('profiles').select('user_type').eq('id', id).maybeSingle()) as { user_type: string } | null
  return row?.user_type ?? null
}
