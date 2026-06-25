# Deploying Optryva to Cloudflare (split: Pages + API Worker)

Optryva is deployed as **two pieces** that talk over HTTPS:

| Piece | Product | URL |
|---|---|---|
| Client (Vite SPA) | Cloudflare **Pages** | `https://optryva.pages.dev` |
| API (`/api/*`) | Cloudflare **Worker** (`server/src/worker.ts`) | `https://optryva-api.<subdomain>.workers.dev` |
| Weekly rubric calibration | Worker cron (`triggers.crons` → `scheduled()`) | — |
| Nightly batch rescore | **Not** on Workers (polls up to 1h) — run `cd server && npm run rescore` from CI/cron | — |
| Database | Supabase (external, REST) | — |

Because they're on different origins, the client sends `credentials: 'include'`,
the API allows the Pages origin via **CORS**, and the refresh cookie is
`SameSite=None; Secure` (`COOKIE_SAMESITE=none` on the API Worker).

## A. API Worker (`optryva-api`)

### One-time
```bash
npm install
npx wrangler login
```
Set secrets (these replace `server/.env`):
```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put JWT_ACCESS_SECRET
npx wrangler secret put JWT_REFRESH_SECRET
npx wrangler secret put VOYAGE_API_KEY          # optional (semantic search)
```
Set the Pages origin so CORS allows it (plain var, not a secret):
```bash
npx wrangler deploy   # COOKIE_SAMESITE=none comes from wrangler.jsonc "vars"
```
Then in the dashboard add **`CLIENT_ORIGIN=https://optryva.pages.dev`**
(Worker → Settings → Variables). `*.optryva.pages.dev` preview origins are
already allowed in code.

### Deploy
```bash
npm run deploy:api      # = build:api + wrangler deploy
```
Gives `https://optryva-api.<subdomain>.workers.dev`.

## B. Client (Pages → `optryva.pages.dev`)

Set the API URL the build bakes in — edit `client/.env.production`:
```
VITE_API_URL=https://optryva-api.<subdomain>.workers.dev/api
```

**Connect via GitHub (recommended):** dashboard → Workers & Pages → Create →
**Pages** → Connect to Git → pick the repo. Build settings:

| Field | Value |
|---|---|
| Project name | `optryva`  (→ `optryva.pages.dev`) |
| Root directory | `client` |
| Build command | `npm install && npm run build` |
| Build output directory | `dist` |

**Or from the CLI:**
```bash
npm run deploy:client   # = build:client + wrangler pages deploy client/dist --project-name optryva
```

## C. Database
Run `server/supabase/init.sql` then migrations `0008`–`0011` in the Supabase
SQL Editor (see the match-engine notes).

## Local development
- **Fast client HMR:** Vite (`cd client && npm run dev`, :5173) against the Node
  API (`cd server && npm run dev`, :4000). Cross-origin localhost is allowed by
  the CORS rule in `app.ts`.
- **Worker locally:** `npm run dev` (wrangler) with a `.dev.vars` file
  (gitignored) holding the same keys as the secrets above.

## Smoke-test after first deploy
- **Auth (the cross-origin risk):** register/login/refresh from `optryva.pages.dev`
  and confirm the `optryva_rt` cookie is set (`SameSite=None; Secure`) and the
  refresh call succeeds. If not, check `CLIENT_ORIGIN` matches exactly and the
  Worker is HTTPS.
- **Cron:** calibration runs weekly (Mon 03:00 UTC); needs ≥ 20 outcomes.
- **rescore:** schedule `npm run rescore` separately (GitHub Actions cron or any
  Node host) — it submits an Anthropic Batch job and polls, exceeding a single
  Worker invocation.
