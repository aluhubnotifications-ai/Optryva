// ----------------------------------------------------------------------------
// Admin gating. Admins are identified by email (no schema change needed) via the
// ADMIN_EMAILS env var — a comma-separated allowlist. Defaults to the app owner
// so /admin works out of the box in dev; set ADMIN_EMAILS in prod to control it.
// ----------------------------------------------------------------------------
import type { ShimReq, ShimRes, Next } from '@/lib/http'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? 'horugavye@autohiretechnologies.com, j.horugavye@alustudent.com')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

export function isAdminEmail(email?: string | null): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase())
}

/** Require the authed user to be an admin. Mount AFTER requireAuth. */
export function requireAdmin(req: ShimReq, res: ShimRes, next: Next) {
  if (!isAdminEmail(req.user?.email)) return res.status(403).json({ error: 'forbidden' })
  next()
}
