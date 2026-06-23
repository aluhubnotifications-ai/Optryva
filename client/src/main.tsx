import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from '@/app/router'
import { ThemeProvider } from '@/lib/theme'
import { ToastProvider } from '@/components/ui/toast'
import './styles/globals.css'

// This app has NO service worker. If a stale one from a previous PWA build is
// still registered on this origin, it intercepts requests and serves cached
// assets (e.g. "Optryva.js"), breaking the real Vite bundle. Tear it down.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((regs) => {
      if (regs.length) {
        Promise.all(regs.map((r) => r.unregister()))
          .then(() => (window.caches ? caches.keys() : Promise.resolve([] as string[])))
          .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
          .then(() => location.reload()) // one reload to load fresh, uncached assets
          .catch(() => {})
      }
    })
    .catch(() => {})
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
