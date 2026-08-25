// Cloudflare Pages Function: proxy /api/* to the Optryva API Worker.
// This makes the API same-origin with the Pages frontend (optryva.pages.dev),
// which is required because the OAuth redirect URI host must be an authorised
// domain — and *.workers.dev (two levels under the public suffix) cannot be one.
// Cookies set by the Worker flow back through this proxy as first-party cookies
// on optryva.pages.dev, so the session works without cross-site cookie hacks.

const WORKER_URL = 'https://optryva.aluhub-notifications.workers.dev'

export async function onRequest(context: { request: Request }) {
  const { request } = context
  const url = new URL(request.url)

  // Rebuild the request against the Worker, dropping hop-by-hop headers that
  // fetch would recompute (host/content-length) and the pages.dev origin so the
  // Worker's CORS check sees the real origin (or none, for same-origin).
  const headers = new Headers()
  for (const [key, value] of request.headers.entries()) {
    const lower = key.toLowerCase()
    if (lower === 'host' || lower === 'content-length') continue
    headers.set(key, value)
  }

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
  }

  const target = `${WORKER_URL}${url.pathname}${url.search}`
  return fetch(target, init)
}
