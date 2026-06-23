# Deploying Optryva to Cloudflare

Optryva ships as a **single Cloudflare Worker** that serves the built React client
(`client/dist`) as static assets and the API at `/api/*`. Same origin → no CORS and
a same-site auth cookie. Supabase remains the database (reached over REST), and
Claude/Voyage are called from the Worker.

## Architecture

| Piece | Where it runs |
|---|---|
| Client (Vite SPA) | Cloudflare static assets, SPA fallback |
| API (`/api/*`) | Worker — `server/src/worker.ts` (Hono app in `server/src/app.ts`) |
| Weekly rubric calibration | Worker cron (`triggers.crons` → `scheduled()`) |
| Nightly batch rescore | **Not** on Workers (polls up to 1h) — run `cd server && npm run rescore` from CI/cron |
| Database | Supabase (external, REST) |

The Express server was ported to Hono via a tiny Express-compatible shim
(`server/src/lib/http.ts`), so the route handlers are unchanged.

## One-time setup

1. **Install + log in**
   ```bash
   npm install            # root: installs wrangler
   npx wrangler login
   ```

2. **Set secrets** (these replace `server/.env` — never commit them):
   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put JWT_ACCESS_SECRET
   npx wrangler secret put JWT_REFRESH_SECRET
   npx wrangler secret put VOYAGE_API_KEY     # optional (semantic search)
   ```
   `process.env.*` is populated from these automatically (`nodejs_compat`,
   compatibility_date ≥ 2025-04-01).

3. **Database**: run `server/supabase/init.sql` then migrations `0008`–`0011`
   in the Supabase SQL Editor (see the match-engine notes).

## Deploy

```bash
npm run deploy     # builds client/dist, then `wrangler deploy`
```

Gives you `https://optryva.<your-subdomain>.workers.dev`. Add a custom domain
in the Cloudflare dashboard (or `routes` in `wrangler.jsonc`) when ready.

## Local development

- **Worker + assets (prod-like, single origin):**
  ```bash
  npm run build && npx wrangler dev        # needs a .dev.vars file (gitignored)
  ```
  Put local secrets in `.dev.vars` (same keys as above).
- **Fast client HMR:** run Vite (`cd client && npm run dev`, :5173) against the
  Node API (`cd server && npm run dev`, :4000). Cross-origin dev is allowed by the
  CORS rule in `app.ts`.

## Notes / things to smoke-test after first deploy

- **Auth**: `jsonwebtoken` + `bcryptjs` run under `nodejs_compat`. Verify
  register/login/refresh once after deploy.
- **Cron**: `triggers.crons` runs calibration weekly (Mon 03:00 UTC); needs
  ≥ 20 application outcomes to do anything.
- **rescore**: schedule `npm run rescore` separately (GitHub Actions cron or any
  Node host) — it submits an Anthropic Batch job and polls, which exceeds a single
  Worker invocation.
