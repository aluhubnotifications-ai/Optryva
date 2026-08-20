// Tiny in-memory TTL cache for expensive read endpoints. Per Worker instance
// (best-effort — an instance may be recycled), keyed by caller/viewer so users
// never share results. Used to absorb the 30s nav-badge poll and repeated
// dashboard calls without re-hitting Postgres every time.

interface Entry<T> {
  value: T
  expire: number
}

const store = new Map<string, Entry<unknown>>()

export function cacheGet<T>(key: string): T | undefined {
  const e = store.get(key)
  if (!e) return undefined
  if (e.expire < Date.now()) {
    store.delete(key)
    return undefined
  }
  return e.value as T
}

export function cacheSet<T>(key: string, value: T, ttlMs = 15_000): void {
  store.set(key, { value, expire: Date.now() + ttlMs })
}

export function cacheDelete(key: string): void {
  store.delete(key)
}

export function cacheDeletePrefix(prefix: string): void {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k)
}
