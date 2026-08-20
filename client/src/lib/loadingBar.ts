// Tiny request counter that drives the global progress bar. Each in-flight API
// call increments; on settle it decrements. The bar shows whenever the count is
// above zero (or the router is navigating between routes).

let count = 0
const listeners = new Set<() => void>()

export function startLoad(): void {
  count++
  notify()
}

export function endLoad(): void {
  count = Math.max(0, count - 1)
  notify()
}

export function isLoading(): boolean {
  return count > 0
}

export function subscribeLoad(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notify(): void {
  listeners.forEach((l) => l())
}
