# How Optryva works (a small guide)

A plain-language tour of the moving parts — especially the AI matching, the
external-apply tracking, and the activity panel.

## 1. The big picture

Optryva is deployed as **two pieces** that talk over HTTPS:

| Piece | Where | URL |
|---|---|---|
| Frontend (Vite React SPA) | Cloudflare **Pages** | `optryva.pages.dev` |
| API (Hono on a Worker) | Cloudflare **Worker** | `optryva.aluhub-notifications.workers.dev` |
| Database | **Supabase** Postgres (over REST) | — |

Because they're on different origins, the browser sends `credentials: 'include'`,
the API allows the Pages origin via CORS, and the login refresh cookie is
`SameSite=None`.

**Deploys:**
- Push to `master` → Cloudflare Pages auto-builds and ships the **frontend**.
- The **API Worker** ships with `npm run deploy:api` (wrangler). Secrets
  (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, JWT secrets) live as Worker
  secrets, set via `wrangler secret put`.
- DB schema changes are SQL files in `server/supabase/migrations/`, run **by
  hand in the Supabase SQL Editor**.

## 2. Login

`POST /api/auth/login` checks the password against Supabase and returns a
short-lived access token (used as a bearer token) plus a refresh cookie. If the
Worker is missing its Supabase secrets, login fails with a 500 — that was the
original "SUPABASE_URL must be set" error.

## 3. AI matching — the important part

Matching scores how well a student fits each job, 0–99. It is **on-demand and
cached**, not a background process.

**When it runs:**
- Opening the **student Dashboard** auto-runs matching.
- **Jobs** and **Insights** run it behind the "Run AI matching" button.
- Opening one job's research scores just that job.

**What happens on a request** (`GET /ai/matches`):
1. List every job the student is allowed to see.
2. For each job, check the `ai_match_cache`:
   - **cached & fresh** → return the saved score instantly (no AI call).
   - **never scored** (e.g. a new job) → score it now with Claude, then cache it.
   - **stale** → re-score now, refresh the cache.

So it **does** pick up new jobs and changes — but lazily, the next time the
student opens a match surface. Nothing re-matches on its own (the only scheduled
job is a weekly honesty *calibration*, not matching).

**What makes a cached score "stale":**
- the **job is edited** → that job's caches are marked stale, or
- the **student edits their profile** → all their caches are marked stale.

Unchanged pairs are always served from cache — Claude scoring is the expensive
step, so it only re-runs when the inputs actually change.

> Note: the cache reacts to job/profile edits only. If the *matching logic*
> itself changes, old scores won't refresh automatically — use the
> `batch-rescore` script or mark rows stale.

## 4. External listings: "opened" instead of "applicants"

A listing can apply **on-platform** (in-app) or **off-platform** (an external
`apply_url`).

- **In-app** roles receive real applications → companies see **applicant** counts.
- **External** roles apply on the company's own site, so Optryva never receives
  an application — the applicant count would always be 0 and misleading. Instead
  we count **unique people who clicked through** the apply link ("views").

How it's tracked:
- A `job_opens` table keyed `(job_id, user_id)` — one row per person per job.
- Clicking apply on an external role calls `POST /jobs/:id/open` (idempotent).
- Company views (Listings, the listing detail, Dashboard, Analytics) show
  **"N opened / views"** for external roles and **"N applicants"** for in-app.

## 5. The AI activity panel (students)

Matching, research, the career compass, and CV review all run server-side and
can be slow or fail. The activity panel gives students a live window into it.

- Every AI call reports through a small `trackAi()` helper into an activity store.
- A persistent pill (bottom-right) shows status at a glance: **spinner = working**,
  **red = had an issue**, **grey = idle**.
- Tapping it opens a live log with timestamps and honest error rows
  ("couldn't reach the AI — using a basic fallback") instead of a fake success.

There's no "worker" to wake — the engine is request-driven and Cloudflare
cold-starts in milliseconds. The panel surfaces the *real* activity as it happens.

## 6. Colors / theming

The UI uses CSS variables (HSL) in `client/src/styles/globals.css`, wired into
Tailwind tokens (`primary`, `accent`, `success`, etc.) with light/dark variants.

- **Base** is neutral black/white (`--primary`).
- **`--accent` is Alibaba orange** — the highlight used for numbers, bars, score
  rings, focus rings, and the logo gradient.
- Match **score rings** use a 5-step scale: green (Excellent) → violet (Strong)
  → orange (Possible) → amber (Weak) → red (Poor).

To rebrand, change `--accent` (and `--primary`) in `globals.css`; everything
that uses those tokens updates at once.
