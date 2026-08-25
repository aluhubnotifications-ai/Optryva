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
          if (id.includes('@tensorflow') || id.includes('blazeface')) return // keep lazy (proctor)
          if (id.includes('framer-motion') || id.includes('/motion-dom/') || id.includes('/motion-utils/')) return 'vendor-motion'
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory')) return 'vendor-charts'
          if (id.includes('react-router') || id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'vendor-react'
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true, // fail loudly if 5173 is taken instead of drifting to 5174
    host: true,
  },
})
