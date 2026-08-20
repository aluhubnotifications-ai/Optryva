import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from '@/app/router'
import { ThemeProvider } from '@/lib/theme'
import { ToastProvider } from '@/components/ui/toast'
import './styles/globals.css'

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
        <RouterProvider router={router} />
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
