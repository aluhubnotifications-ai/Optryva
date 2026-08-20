// Lightweight performance instrumentation. Every measurement is prefixed with
// [Optryva perf] so it's easy to spot (and strip later). Logs are on in dev, or
// in any build when the URL contains `?perf` (e.g. http://localhost:4173/?perf).
const hasPerfFlag =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('perf')
const PERF_ENABLED = hasPerfFlag || ((import.meta as any).env?.DEV ?? false)

const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
export const APP_BOOT_MS = t0

export function perf(label: string, ...rest: unknown[]): void {
  if (!PERF_ENABLED) return
  const ms = Math.round((performance.now() - t0) * 10) / 10
  // eslint-disable-next-line no-console
  console.log(`[Optryva perf] +${ms}ms  ${label}`, ...rest)
}

/** Time an async function, logging its wall-clock duration. */
export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!PERF_ENABLED) return fn()
  const start = performance.now()
  try {
    return await fn()
  } finally {
    const ms = Math.round((performance.now() - start) * 10) / 10
    perf(`${label}  →  ${ms}ms`)
  }
}
