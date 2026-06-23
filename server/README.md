# Optryva API (Phase B backend)

Express + TypeScript + SQLite (better-sqlite3). Custom JWT auth (bcrypt cost 12).
AI via Anthropic Claude (`claude-opus-4-8`), with a deterministic/canned **fallback**
when `ANTHROPIC_API_KEY` is unset — so it runs with or without a key.

## Run

```bash
cd server
cp .env.example .env      # optionally add ANTHROPIC_API_KEY
npm install
npm run start             # http://localhost:4000  (auto-seeds an empty DB)
# npm run seed            # (re)seed demo data explicitly
# npm run dev             # watch mode
```

Demo accounts (password **`Demo2026!`**): `amara@student.dev` (student),
`careers@university.edu` (school), and company accounts (Cloudflare/Flutterwave/
Helium Health/Jumia) via their emails in `src/seed.ts`.

## Endpoints (all under `/api`)

- **auth**: `POST /auth/register|login|refresh|logout|change-password|delete-account`, `GET /auth/me`
  (access token in `Authorization: Bearer`, refresh token in an httpOnly cookie)
- **profiles**: `GET /profiles?type=`, `GET /profiles/:id`, `PATCH /profiles/:id`
  (CV/skills/role changes mark cached matches `stale`)
- **jobs**: `GET /jobs` (server-side **year + school** gating), `GET /jobs/:id`,
  `GET /jobs/company/:id`, `POST /jobs` (notifies followers), `PATCH/DELETE /jobs/:id`
- **applications**: `GET /applications/mine|company|job/:id|:id`, `POST /applications`,
  `PATCH /applications/:id/status`, `DELETE /applications/:id`
- **ai**: `GET /ai/match/:jobId` & `GET /ai/matches` (cached, Claude-blended 0.8/0.2 +
  completeness cap), `POST /ai/source`, `POST /ai/company`, `POST /ai/chat`,
  `POST /ai/coach`, `POST /ai/cv-tips`, `POST /ai/research/ask`,
  `POST /ai/compass/interview|recommend|prep`, `GET /ai/_status`
- **social**: follows (`/social/follows/*`), ratings (`/social/ratings*`)
- **notifications**: `GET /notifications`, `POST /notifications/:id/read`, `/read-all`
- **messages**: `GET /messages/conversations`, `GET /messages/thread/:id`, `POST /messages`,
  reactions, delete, `POST /messages/dm/:otherId`

## Architecture notes

- `src/db.ts` — schema + JSON helpers. `src/lib/matching.ts` — deterministic engine
  (port of the client's). `src/lib/claude.ts` — Anthropic wrapper + JSON extraction +
  `MODELS` config. `src/lib/auth.ts` — JWT sign/verify + `requireAuth`.
- AI match cache lives in `ai_match_cache`; invalidated on profile/job edits.
- **Swap step (frontend):** point `client/src/lib/api.ts` at these routes (fetch +
  TanStack Query). The function signatures already match the mock layer.
