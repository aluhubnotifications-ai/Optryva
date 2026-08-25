import { startTransition, useCallback } from 'react'
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom'

/**
 * Drop-in replacement for `useNavigate` that wraps the navigation in a
 * `startTransition`. This prevents React error #300 ("A component suspended
 * while responding to synchronous input") when the destination route is a
 * `lazy()` chunk that hasn't been fetched yet — e.g. clicking into a page for
 * the first time. A transition tells React the update is non-urgent, so it can
 * show the Suspense fallback instead of throwing.
 */
export function useTransitionNavigate() {
  const navigate = useNavigate()
  return useCallback(
    (to: To | number, options?: NavigateOptions) => {
      if (typeof to === 'number') startTransition(() => navigate(to))
      else startTransition(() => navigate(to, options))
    },
    [navigate],
  )
}
