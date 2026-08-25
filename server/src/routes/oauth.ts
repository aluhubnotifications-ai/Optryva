import { Router } from '@/lib/http'
import { sb, must } from '@/db'
import { uid, now } from '@/lib/util'
import { signAccess, signRefresh, type AuthUser } from '@/lib/auth'
import { rowToProfile } from '@/lib/serialize'

export const oauth = Router()

// Google OAuth configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI // e.g. https://api.optryva.workers.dev/api/oauth/google/callback

// Cookies are only marked `secure` in production (or when cross-site), so the
// OAuth state cookie actually gets stored on http://localhost during dev.
// (Mirrors the refresh-cookie handling lower down.)
const crossSite = process.env.COOKIE_SAMESITE === 'none'
const secureCookie = crossSite || process.env.NODE_ENV === 'production'
const stateSameSite = crossSite ? 'none' : 'lax'

// Generate Google OAuth authorization URL with PKCE
function generateAuthUrl(state: string, codeChallenge: string, codeChallengeMethod = 'S256'): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID!,
    redirect_uri: GOOGLE_REDIRECT_URI!,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    access_type: 'offline',
    prompt: 'consent',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

// Verify PKCE code verifier against challenge
async function verifyPKCE(codeVerifier: string, codeChallenge: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const data = encoder.encode(codeVerifier)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashBase64 = btoa(String.fromCharCode(...hashArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
  return hashBase64 === codeChallenge
}

// Decode a base64url string. JWT segments are base64url WITHOUT padding, which
// the Workers runtime's atob rejects unless we restore the '=' padding first.
function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4
  const padded = pad ? b64 + '='.repeat(4 - pad) : b64
  return atob(padded)
}

// Exchange authorization code for tokens
async function exchangeCodeForTokens(code: string, codeVerifier: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID!,
      client_secret: GOOGLE_CLIENT_SECRET!,
      redirect_uri: GOOGLE_REDIRECT_URI!,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error_description ?? 'token_exchange_failed')
  }
  return res.json() as Promise<{
    access_token: string
    refresh_token?: string
    id_token: string
    expires_in: number
    token_type: string
  }>
}

// Verify Google ID token and extract user info
async function verifyIdToken(idToken: string) {
  // Fetch Google's public keys
  const keysRes = await fetch('https://www.googleapis.com/oauth2/v3/certs')
  const { keys } = await keysRes.json()
  
  // Parse JWT header to find the right key
  const [headerB64] = idToken.split('.')
  const header = JSON.parse(b64urlDecode(headerB64))
  
  const key = keys.find((k: any) => k.kid === header.kid)
  if (!key) throw new Error('no_matching_key')
  
  // Verify signature using Web Crypto API
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    { ...key, kty: 'RSA', alg: 'RS256', use: 'sig' },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  )
  
  const signatureB64 = idToken.split('.')[2]
  const signed = `${headerB64}.${idToken.split('.')[1]}`
  const data = new TextEncoder().encode(signed)
  const signature = new Uint8Array(b64urlDecode(signatureB64).split('').map(c => c.charCodeAt(0)))
  
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, data)
  if (!valid) throw new Error('invalid_signature')
  
  // Parse payload
  const payloadB64 = idToken.split('.')[1]
  const payload = JSON.parse(b64urlDecode(payloadB64))
  
  // Verify claims
  if (payload.aud !== GOOGLE_CLIENT_ID) throw new Error('invalid_audience')
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
    throw new Error('invalid_issuer')
  }
  if (payload.exp * 1000 < Date.now()) throw new Error('token_expired')
  
  return {
    sub: payload.sub,
    email: payload.email,
    email_verified: payload.email_verified,
    name: payload.name,
    picture: payload.picture,
    given_name: payload.given_name,
    family_name: payload.family_name,
  }
}

// Step 1: Initiate Google OAuth — generates PKCE, stores state+verifier in session cookie, redirects to Google
oauth.get('/google', async (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    return res.status(500).json({ error: 'oauth_not_configured' })
  }
  
  // Generate PKCE code verifier and challenge
  const codeVerifier = uid('cv')
  const encoder = new TextEncoder()
  const data = encoder.encode(codeVerifier)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const codeChallenge = btoa(String.fromCharCode(...hashArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
  
  // Generate state with embedded return URL and PKCE verifier
  const returnTo = (req.query.returnTo as string) || '/app'
  const statePayload = { r: returnTo, cv: codeVerifier, cs: 'S256' }
  const state = btoa(JSON.stringify(statePayload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  
  // Store state in a short-lived cookie (validated in callback)
  res.cookie('oauth_state', state, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: stateSameSite,
    maxAge: 10 * 60 * 1000, // 10 minutes (shim converts ms -> seconds)
    path: '/',
  })
  
  const authUrl = generateAuthUrl(state, codeChallenge)
  return res.redirect(authUrl)
})

// Step 2: Google OAuth callback — verifies state, exchanges code, creates/finds user, redirects to role selection
oauth.get('/google/callback', async (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    return res.status(500).json({ error: 'oauth_not_configured' })
  }
  
  const { code, state, error } = req.query
  
  if (error) {
    return res.redirect(`/?oauth_error=${encodeURIComponent(error)}`)
  }
  if (!code || !state) {
    return res.redirect('/?oauth_error=missing_params')
  }
  
  // Retrieve and validate state cookie
  const stateCookie = req.cookies?.oauth_state
  res.clearCookie('oauth_state', { path: '/' })
  
  if (!stateCookie || stateCookie !== state) {
    return res.redirect('/?oauth_error=invalid_state')
  }
  
  let statePayload: { r: string; cv: string; cs: string }
  try {
    statePayload = JSON.parse(b64urlDecode(stateCookie))
  } catch {
    return res.redirect('/?oauth_error=invalid_state_payload')
  }
  
  const { r: returnTo, cv: codeVerifier, cs: codeChallengeMethod } = statePayload
  
  try {
    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code as string, codeVerifier)
    
    // Verify ID token and get user info
    const googleUser = await verifyIdToken(tokens.id_token)
    
    if (!googleUser.email_verified) {
      return res.redirect('/?oauth_error=email_not_verified')
    }
    
    // Check if user exists by provider identity
    const existingProvider = must(await sb
      .from('app_users')
      .select('*')
      .eq('auth_provider', 'google')
      .eq('provider_subject', googleUser.sub)
      .maybeSingle())
    
    let profile: any
    
    if (existingProvider) {
      // Existing Google user — log them in
      const user = existingProvider as any
      const p = must(await sb.from('profiles').select('*').eq('id', user.id).maybeSingle())
      profile = p
      
      // Update provider metadata (new tokens)
      must(await sb
        .from('app_users')
        .update({
          provider_metadata: JSON.stringify({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            updated_at: now(),
          }),
        })
        .eq('id', user.id))
    } else {
      // Check if email exists with email/password account
      const existingEmail = must(await sb
        .from('app_users')
        .select('*')
        .eq('email', googleUser.email)
        .maybeSingle()) as any
      
      if (existingEmail) {
        // Email exists but not linked to Google — require linking flow
        // For now, store pending link info and redirect to link page
        // This implements the account-linking rule from spec
        res.cookie('pending_google_link', JSON.stringify({
          email: googleUser.email,
          google_sub: googleUser.sub,
          google_name: googleUser.name,
          google_picture: googleUser.picture,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          returnTo,
        }), {
          httpOnly: true,
          secure: secureCookie,
          sameSite: stateSameSite,
          maxAge: 10 * 60 * 1000, // 10 minutes (shim converts ms -> seconds)
          path: '/',
        })
        return res.redirect('/link-account?provider=google')
      }
      
      // Brand new user — create account with Google, but DON'T assign role yet
      // They will choose role on the next screen
      const id = uid('u')
      const ts = now()
      
      must(await sb.from('app_users').insert({
        id,
        email: googleUser.email,
        password_hash: null, // No password for Google-only accounts
        email_verified: 1,
        auth_provider: 'google',
        provider_subject: googleUser.sub,
        provider_metadata: JSON.stringify({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          created_at: ts,
        }),
        created_at: ts,
      }))
      
      // Create a minimal profile — user_type will be set after role selection
      // Default to 'student' but mark onboarding incomplete
      must(await sb.from('profiles').insert({
        id,
        user_type: 'student', // temporary, will update after role selection
        full_name: googleUser.name ?? googleUser.email.split('@')[0],
        email: googleUser.email,
        avatar_url: googleUser.picture,
        plan: 'free',
        created_at: ts,
      }))
      
      // Initialize onboarding progress
      must(await sb.from('onboarding_progress').insert({
        account_id: id,
        role: 'student', // will be updated after role selection
        current_step: 1,
        completed_steps: 0,
        skipped_steps: '[]',
        updated_at: ts,
      }))
      
      profile = must(await sb.from('profiles').select('*').eq('id', id).maybeSingle())
    }
    
    // Check if onboarding is complete for this user
    const progress = must(await sb
      .from('onboarding_progress')
      .select('*')
      .eq('account_id', profile.id)
      .maybeSingle()) as any
    
    const user = await authUserFromRow(profile)
    
    const accessToken = signAccess(user)
    const refreshToken = signRefresh(user)
    
    const CROSS_SITE = process.env.COOKIE_SAMESITE === 'none'
    const cookieOpts = {
      httpOnly: true,
      sameSite: CROSS_SITE ? ('none' as const) : ('lax' as const),
      secure: CROSS_SITE || process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
    }
    
    res.cookie('optryva_rt', refreshToken, cookieOpts)
    
    // Redirect to the Profile hub. The client keeps a new student on their
    // Profile (with a progress card) until the important onboarding steps are
    // done, so we always land there after Google sign-in. `returnTo` is still
    // honoured for users who already finished onboarding.
    const clientOrigin = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'
    const redirectUrl =
      progress && progress.completed_steps > 0 && progress.current_step <= progress.completed_steps
        ? `${clientOrigin}${returnTo}`
        : `${clientOrigin}/app/profile`
    return res.redirect(redirectUrl)
  } catch (err) {
    console.error('Google OAuth callback error:', err)
    const detail = err instanceof Error ? err.message : String(err)
    return res.redirect('/?oauth_error=callback_failed&detail=' + encodeURIComponent(detail))
  }
})

async function authUserFromRow(p: any): Promise<AuthUser> {
  return { id: p.id, email: p.email, user_type: p.user_type } as AuthUser
}