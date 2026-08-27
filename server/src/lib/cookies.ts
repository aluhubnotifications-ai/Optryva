import type { ShimReq } from './http'

// ----------------------------------------------------------------------------
// Auth-cookie options (refresh token, OAuth state, pending link).
//
// The old logic keyed off COOKIE_SAMESITE + NODE_ENV, which forced `Secure`
// cookies whenever the Worker ran with NODE_ENV=production — including local
// dev over plain HTTP. Browsers drop Secure cookies on HTTP, so neither the
// `oauth_state` nor the `optryva_rt` refresh cookie survived, and Google
// sign-in bounced straight back to /login.
//
// We now decide from the ACTUAL request, the way browsers do:
//   - Same-site is hostname-based (port-agnostic): a client on localhost:5173
//     and an API on localhost:4000 are the same site, so a Lax (non-Secure on
//     HTTP) cookie works fine.
//   - Different hosts (Pages <-> Worker on separate domains) need SameSite=None
//     + Secure, which is only valid over HTTPS — and production is HTTPS.
// ----------------------------------------------------------------------------

// Session cap: the refresh cookie outlives the access token, but not beyond 5d —
// matches REFRESH_TTL in lib/auth.ts so a 5d-old session can no longer refresh.
const SESSION_TTL_MS = 5 * 24 * 60 * 60 * 1000

export function authCookieOptions(req: ShimReq, maxAgeMs = SESSION_TTL_MS) {
  const reqUrl = new URL(req.raw.req.url ?? 'http://localhost')
  const apiHost = reqUrl.hostname
  const clientOrigin = process.env.CLIENT_ORIGIN
  const clientHost = clientOrigin ? new URL(clientOrigin).hostname : apiHost
  const crossSite = apiHost !== clientHost
  const isHttps = reqUrl.protocol === 'https:'
  return {
    httpOnly: true,
    sameSite: (crossSite ? 'none' : 'lax') as 'none' | 'lax',
    // SameSite=None REQUIRES Secure; on same-site we only need Secure on HTTPS.
    secure: crossSite ? true : isHttps,
    maxAge: maxAgeMs,
    path: '/',
  }
}
