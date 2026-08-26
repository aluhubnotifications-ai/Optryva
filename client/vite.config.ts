import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    minify: 'esbuild',
    // Keep component/function names so React's #300 componentStack (rendered
    // on-screen by ErrorBoundary) names the real suspending component instead
    // of a minified alias — critical for diagnosing error #300.
    esbuild: { keepNames: true },
    rollupOptions: {
      output: {
        // Split only the universally-used vendors into their own content-hashed
        // chunks (cached across deploys, fetched in parallel). We deliberately do
        // NOT use a catch-all `vendor` chunk: that would force every
        // node_modules dep — including TensorFlow.js, which is only needed by the
        // proctoring feature — into the initial bundle, defeating route-level
        // code splitting. Anything not named here falls through to Rollup's
        // default splitting, which keeps lazy routes (and tfjs) lazy.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // @tensorflow / blazeface: keep lazy (proctor, ~590 KB) — do NOT assign
          if (id.includes('@tensorflow') || id.includes('blazeface')) return
          if (id.includes('framer-motion') || id.includes('/motion-dom/') || id.includes('/motion-utils/')) return 'vendor-motion'
          // recharts/d3/victory: do NOT assign to a shared vendor chunk. Keeping
          // them unassigned lets Rollup place them inside the lazily-imported
          // route that actually uses them (Analytics), so they are never eagerly
          // downloaded or modulepreloaded on the initial page load.
          if (id.includes('react-router') || id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'vendor-react'
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true,
  },
})
