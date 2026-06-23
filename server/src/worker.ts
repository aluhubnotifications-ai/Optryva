// Cloudflare Worker entry. Serves the API (/api/*) and runs the weekly
// honesty-calibration cron. Static assets (the built client) are served by
// Cloudflare directly per wrangler.jsonc — they never reach this handler.
//
// Env vars + secrets (ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// JWT_*, VOYAGE_API_KEY, CLIENT_ORIGIN) are exposed via process.env by the
// `nodejs_compat` flag (compatibility_date >= 2025-04-01), so the existing
// process.env reads in db.ts / claude.ts / auth.ts work unchanged.

import { app } from '@/app'
import { runCalibration } from '@/scripts/calibrate'

export default {
  fetch: app.fetch,
  // Cron: tighten the scoring rubric from real hiring outcomes (see wrangler
  // triggers). One Opus call + a DB write — safely inside a Worker invocation.
  async scheduled(_event: unknown, _env: unknown, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
    ctx.waitUntil(runCalibration())
  },
}
