// Shared, in-flight-deduplicated cache for read API calls. Keeps a single
// in-flight promise per key so concurrent callers (AppShell nav badges, the
// Dashboard, etc.) reuse the same request instead of each firing their own.
// Results are cached for a short TTL so background badge polling and page
// reloads don't re-hit the server on every render.

type Entry<T> = { value: T; expire: number; promise?: Promise<T> }

const DEFAULT_TTL = 20_000
const cache = new Map<string, Entry<unknown>>()

export function cached<T>(key: string, fn: () => Promise<T>, ttl: number = DEFAULT_TTL): Promise<T> {
  const now = Date.now()
  const existing = cache.get(key) as Entry<T> | undefined
  if (existing) {
    if (existing.promise) {
      if ((import.meta as any).env?.DEV ?? false)
        console.log(`[Optryva perf] cache DEDUPE  ${key}  (in-flight, reusing request)`)
      return existing.promise
    }
    if (existing.expire > now) {
      if ((import.meta as any).env?.DEV ?? false)
        console.log(`[Optryva perf] cache HIT     ${key}  (served from cache, 0ms)`)
      return Promise.resolve(existing.value)
    }
  }
  if ((import.meta as any).env?.DEV ?? false)
    console.log(`[Optryva perf] cache MISS    ${key}  (fetching from server)`)
  const start = performance.now()
  const promise = fn()
    .then((value) => {
      if ((import.meta as any).env?.DEV ?? false) {
        const ms = Math.round((performance.now() - start) * 10) / 10
        console.log(`[Optryva perf] fetch done    ${key}  →  ${ms}ms`)
      }
      cache.set(key, { value, expire: Date.now() + ttl })
      return value
    })
    .catch((err) => {
      cache.delete(key)
      throw err
    })
  cache.set(key, { value: undefined as unknown as T, expire: now + ttl, promise })
  return promise
}

/** Drop one or more cached keys (or the whole cache when called with no args).
 *  Call after a mutation so the next read picks up fresh server state. */
export function invalidateCache(...keys: string[]): void {
  if (keys.length === 0) {
    cache.clear()
    return
  }
  for (const k of keys) cache.delete(k)
}
