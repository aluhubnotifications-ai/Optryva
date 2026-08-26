// Cloudflare Worker entry. Serves the API (/api/*) and runs the weekly
// honesty-calibration cron. Static assets (the built client) are served by
// Cloudflare directly per wrangler.jsonc — they never reach this handler.
//
// Env vars + secrets (ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// JWT_*, VOYAGE_API_KEY, CLIENT_ORIGIN) are exposed via process.env by the
// `nodejs_compat` flag (compatibility_date >= 2025-04-01), so the existing
// process.env reads in db.ts / claude.ts / auth.ts work unchanged.

import { app } from '@/app'
import { setExtractionBinding } from '@/lib/extractionClient'
import { runCalibration } from '@/scripts/calibrate'

// The Extraction Worker (`optryva-extract`) is called via a SERVICE BINDING, not
// over HTTPS. Workers cannot fetch other `*.workers.dev` hostnames (error 1042),
// so the binding is what actually makes evidence AI work in production. See the
// big comment in @/lib/extractionClient for the full rationale.
import { runEval } from '@/scripts/eval-matching'
import { buildFeatures } from '@/scripts/build-features'
import { trainRanker } from '@/scripts/train-ranker'
import { trainDistill } from '@/scripts/train-distill'

export default {
  fetch(request: Request, env: any, ctx: any) {
    if (env?.EXTRACTION) setExtractionBinding(env.EXTRACTION)
    return app.fetch(request, env, ctx)
  },
  // Nightly cron (see wrangler triggers): the whole self-improving loop, in order.
  //   1. calibrate     — tighten the LLM rubric from real outcomes
  //   2. features      — refresh the (student,job) training set + labels
  //   3. train-ranker  — refit the engagement ranker (auto-activates when data is enough)
  //   4. train-distill — refit the model that mimics Claude's score (teacher = cached scores)
  //   5. eval          — log match-quality metrics so we can watch it move
  // Every step self-gates on data, so this is a safe no-op until data exists.
  // All cheap (≤1 Opus call + read-only queries + in-memory training).
  async scheduled(_event: unknown, _env: unknown, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
    ctx.waitUntil((async () => {
      for (const [label, step] of [
        ['calibration', runCalibration], ['features', buildFeatures], ['train-ranker', trainRanker], ['train-distill', trainDistill], ['eval', runEval],
      ] as const) {
        try { await step() } catch (e) { console.error(`${label} failed`, e) }
      }
    })())
  },
}
