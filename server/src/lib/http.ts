// ----------------------------------------------------------------------------
// Minimal Express-compatible router shim over Hono.
//
// The whole app was written against the small slice of Express we actually use:
// `req.body / params / query / headers / cookies / user` and
// `res.json / status / cookie / clearCookie`, plus router-level and per-route
// middleware that either end the response or call `next()`.
//
// This shim reproduces exactly that surface on top of Hono so the route handlers
// run unchanged on Cloudflare Workers (Express can't) — only their `Router`
// import switches from 'express' to '@/lib/http'. New code should prefer Hono
// directly; this exists to port the audited handlers verbatim.
// ----------------------------------------------------------------------------

import { Hono, type Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { AuthUser } from '@/lib/auth'
import { runWithUsageContext } from '@/lib/usage'

export interface ShimReq {
  params: Record<string, string>
  query: Record<string, string | undefined>
  headers: Record<string, string | undefined>
  cookies: Record<string, string | undefined>
  body: any
  user?: AuthUser
  /** Escape hatch to the underlying Hono context, if ever needed. */
  raw: Context
}

export interface CookieOptions {
  httpOnly?: boolean
  // Accept Express-style lowercase as well as the standard casing.
  sameSite?: 'lax' | 'strict' | 'none' | 'Lax' | 'Strict' | 'None'
  secure?: boolean
  /** Milliseconds, as Express expects (converted to seconds for Set-Cookie). */
  maxAge?: number
  path?: string
  expires?: Date
}

export interface ShimRes {
  status(code: number): ShimRes
  json(body: unknown): ShimRes
  /** Stream a Server-Sent-Events body (text/event-stream) instead of JSON. */
  sse(stream: ReadableStream): ShimRes
  cookie(name: string, value: string, opts?: CookieOptions): ShimRes
  clearCookie(name: string, opts?: { path?: string }): ShimRes
  _ended: boolean
  _status: number
  _body: unknown
  _stream?: ReadableStream
}

export type Next = () => void
export type Handler = (req: ShimReq, res: ShimRes, next: Next) => unknown | Promise<unknown>

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'

const normSameSite = (s?: string): 'Lax' | 'Strict' | 'None' | undefined =>
  s ? ((s[0].toUpperCase() + s.slice(1).toLowerCase()) as 'Lax' | 'Strict' | 'None') : undefined

async function buildReq(c: Context): Promise<ShimReq> {
  let body: any
  const method = c.req.method
  if (method !== 'GET' && method !== 'HEAD') {
    // Parse JSON defensively: handlers all read `req.body ?? {}`.
    try {
      const text = await c.req.text()
      body = text ? JSON.parse(text) : undefined
    } catch {
      body = undefined
    }
  }
  return {
    params: c.req.param() as Record<string, string>,
    query: c.req.query(),
    headers: c.req.header() as Record<string, string | undefined>,
    cookies: getCookie(c),
    body,
    raw: c,
  }
}

function buildRes(c: Context): ShimRes {
  return {
    _ended: false,
    _status: 200,
    _body: undefined,
    status(code: number) {
      this._status = code
      return this
    },
    json(body: unknown) {
      this._body = body
      this._ended = true
      return this
    },
    sse(stream: ReadableStream) {
      this._stream = stream
      this._ended = true
      return this
    },
    cookie(name: string, value: string, opts: CookieOptions = {}) {
      setCookie(c, name, value, {
        httpOnly: opts.httpOnly,
        secure: opts.secure,
        sameSite: normSameSite(opts.sameSite),
        path: opts.path,
        maxAge: opts.maxAge != null ? Math.floor(opts.maxAge / 1000) : undefined,
        expires: opts.expires,
      })
      return this
    },
    clearCookie(name: string, opts: { path?: string } = {}) {
      deleteCookie(c, name, { path: opts.path })
      return this
    },
  }
}

class RouterImpl {
  /** The underlying Hono app — mount it with `app.route(prefix, router.hono)`. */
  readonly hono = new Hono()
  private mws: Handler[] = []

  use(mw: Handler): void {
    this.mws.push(mw)
  }

  get(path: string, ...h: Handler[]): void {
    this.register('get', path, h)
  }
  post(path: string, ...h: Handler[]): void {
    this.register('post', path, h)
  }
  put(path: string, ...h: Handler[]): void {
    this.register('put', path, h)
  }
  patch(path: string, ...h: Handler[]): void {
    this.register('patch', path, h)
  }
  delete(path: string, ...h: Handler[]): void {
    this.register('delete', path, h)
  }

  private register(method: Method, path: string, handlers: Handler[]): void {
    this.hono[method](path, async (c) => {
      const req = await buildReq(c)
      const res = buildRes(c)
      // Run router-level middleware, then the route's handlers, Express-style:
      // a fn either ends the response (short-circuit) or calls next() to continue.
      // The whole chain runs inside a usage context so AI calls can be attributed
      // to the authenticated user (set by requireAuth) for usage metering.
      await runWithUsageContext(async () => {
        for (const fn of [...this.mws, ...handlers]) {
          let nexted = false
          await fn(req, res, () => {
            nexted = true
          })
          if (res._ended) break
          if (!nexted) break
        }
      })
      // Streaming response (SSE): hand Hono the ReadableStream directly. The
      // cors() middleware still applies its headers after this returns.
      if (res._stream) {
        return c.body(res._stream as any, res._status as any, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        })
      }
      return c.json(res._body as any, res._status as any)
    })
  }
}

export type Router = RouterImpl
/** Express-style factory: `const r = Router()`. */
export function Router(): RouterImpl {
  return new RouterImpl()
}
