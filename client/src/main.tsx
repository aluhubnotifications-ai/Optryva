import React from 'react'
import ReactDOM from 'react-dom/client'
import { Suspense, useEffect, useState } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router, preloadRoutes } from '@/app/router'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { ThemeProvider } from '@/lib/theme'
import { ToastProvider } from '@/components/ui/toast'
import { bootstrapSession } from '@/lib/api'
import { Spinner } from '@/components/ui/Spinner'
import { DancingMascot } from '@/components/DancingMascot'
import './styles/globals.css'

// Gate the app on a one-time session bootstrap. After OAuth (or a session whose
// stored access token expired) there may be no token in localStorage yet, but
// the httpOnly refresh cookie is present — trade it for a session here so the
// route guards don't bounce a valid user to /login.
function Bootstrap({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    bootstrapSession().finally(() => {
      if (!cancelled) setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])
  // Warm every route chunk once the session is known, so the first navigation
  // into /app/* (e.g. right after onboarding finishes) never has to lazy-load a
  // page and suspend — the root cause of React error #300.
  useEffect(() => {
    if (ready) preloadRoutes()
  }, [ready])
  if (!ready) {
    return (
      <div className="mesh-bg flex min-h-screen items-center justify-center">
        <DancingMascot size={80} />
      </div>
    )
  }
  return <>{children}</>
}

// This app has NO service worker. If a stale one from a previous PWA build is
// still registered on this origin, it intercepts requests and serves cached
// assets, breaking the real Vite bundle. Tear it down — but only once per
// browser, so a future legitimate SW is never force-reloaded on every startup.
const SW_CLEANUP_KEY = 'optryva-sw-cleaned'
if ('serviceWorker' in navigator) {
  if (!localStorage.getItem(SW_CLEANUP_KEY)) {
    const swStart = performance.now()
    navigator.serviceWorker.getRegistrations()
      .then((regs) => {
        if (regs.length) {
          Promise.all(regs.map((r) => r.unregister()))
            .then(() => (window.caches ? caches.keys() : Promise.resolve([] as string[])))
            .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
            .then(() => {
              localStorage.setItem(SW_CLEANUP_KEY, '1')
              console.log(`[Optryva perf] service-worker cleanup  →  ${Math.round((performance.now() - swStart) * 10) / 10}ms (reloading once)`)
              location.reload() // single reload to load fresh, uncached assets
            })
            .catch(() => localStorage.setItem(SW_CLEANUP_KEY, '1'))
        } else {
          // No stale SW present — record the cleanup so we never check again.
          localStorage.setItem(SW_CLEANUP_KEY, '1')
          console.log(`[Optryva perf] service-worker cleanup  →  none present (${Math.round((performance.now() - swStart) * 10) / 10}ms)`)
        }
      })
      .catch(() => localStorage.setItem(SW_CLEANUP_KEY, '1'))
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <Bootstrap>
          <ErrorBoundary>
            <Suspense
              fallback={
                <div className="mesh-bg flex min-h-screen items-center justify-center">
                  <Spinner label="Loading…" />
                </div>
              }
            >
              <RouterProvider
                router={router}
                // Wrap navigations in React.startTransition so that mounting a
                // lazy() route chunk (e.g. /app/profile) suspends into its Suspense
                // fallback instead of throwing React error #300 ("suspended during
                // synchronous input"). This is the v7 default; opting in early here
                // is the supported fix on react-router v6.
                future={{ v7_startTransition: true }}
              />
            </Suspense>
          </ErrorBoundary>
        </Bootstrap>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
