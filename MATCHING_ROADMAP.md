# Optryva Matching Roadmap — from "LLM-per-job" to a learning marketplace matcher

Goal: a job↔candidate matcher that is **scalable to 1M+ live jobs**, **honest**, and
**learns from real outcomes** — modeled on how LinkedIn/Indeed actually do it
(cascade funnel + learning-to-retrieve + outcome calibration), adapted to our
Africa-focused, early-career niche and our stack (Supabase/pgvector, Voyage,
Claude, Cloudflare Workers).

## Where we are (done)
- [x] **v2 honest scorer** — Sonnet, frozen rubric, smooth caps, version-gated cache.
- [x] **v3 retrieval funnel** — Postgres filtered-ANN (HNSW) → Voyage rerank → Claude
      score top ~40. Scales: never loads the corpus. (`candidateJobs` in `routes/ai.ts`,
      migration `0013_match_funnel.sql`.)
- [x] **Opportunity preferences** — `pref_listing_types` / `pref_countries`: out-of-scope
      jobs are never scored (not shown as weak matches). Remote always clears country.
- [x] **Query-driven search funnel** (`/source`) — embeds the natural-language query →
      ANN retrieve (`match_jobs_by_vector`, migration 0018) → Voyage rerank by the query →
      Claude-score a bounded set. No longer scans/scores the whole catalog.
- [x] **Calibration scaffolding exists** — `ai_calibration` table + `scripts/calibrate.ts`
      (currently fires only on terminal hiring outcomes; see Phase 1).

## The frontier gap (what the giants have, we don't)
| Layer | Giants | Us today |
|---|---|---|
| Retrieval embeddings | fine-tuned on engagement | generic Voyage on concatenated text |
| Ranking | learned (LTR) from apply/hire | static LLM rubric, no learning |
| Behavioral signal | clicks/applies/dwell drive everything | `job_opens` + `applications` logged, **unused** |
| Cost at scale | distilled cheap ranker | 40 Sonnet calls/student |
| Feedback loop | closed (outcomes → model) | flywheel built but starved of samples |
| Measurement | nDCG / apply-rate dashboards | **none** |

---

## Phase 1 — Close the data loop (weeks, highest ROI) — IN PROGRESS
The data is already collected; we just aren't using it or measuring anything.
- [ ] **Eval harness** (`npm run eval-matching`): from existing data, compute whether scores
      predict engagement — apply-rate / open-rate by score band, recall@K of applied
      jobs in top-K matches, and score↔outcome correlation. The measurement foundation;
      everything below is judged by it.
- [ ] **Engagement-aware calibration** *(deferred for now)*: extend `calibrate.ts` to treat `job_opens` (clicked
      apply) and created `applications` as POSITIVE implicit feedback, and high-scored
      jobs the student saw but ignored as soft NEGATIVE — so the loop fires with real
      sample sizes long before we have terminal hires.
- [ ] **Hard qualification guardrails**: cheap rule filters before the LLM (must-have
      skills present, seniority within ±1 band, location/work-auth) so embeddings never
      surface "completely off-target" roles. Extends `prefAllowsJob`.
- [x] **Schedule the flywheel** — nightly Cloudflare cron (`0 2 * * *`) runs `runCalibration`
      then logs `runEval` metrics (`worker.ts` + `wrangler.jsonc`). Self-gates on `MIN_SAMPLES`.

### Phase 1.5 — Outcome tracking (the moat), SHIPPED
Capture what happens AFTER the click — the (predicted score → real outcome) loop.
- [x] **Intent-to-apply event**: external "Apply" already fires `trackOpen`; the
      `/jobs/:id/open` endpoint now also opens a `match_outcomes` row, snapshots the
      score we gave, and schedules a check 14 days out (`recordIntent`).
- [x] **`match_outcomes` table + `check_at`** (migration `0014_outcome_tracking.sql`):
      per-(student,job) monitoring record with status state machine + `signals` jsonb.
- [x] **Background-worker contract** (`server/OUTCOME_WORKER.md`): the `due_outcome_checks`
      RPC + write-back shape so the Python worker plugs in. Worker-confirmed
      `likely_hired`/`profile_updated` flow into `calibrate` as positives.
- [x] **Consent-gated & compliant**: opt-in `profiles.monitoring_consent` (Profile UI
      toggle, default OFF). RPC returns ONLY opted-in students. GitHub via official API;
      **no LinkedIn scraping** (ToS/privacy) — compliant sources only.
- [x] **Student nudge UI**: `/insights` returns `outcomeNudges` from `match_outcomes`
      (server `outcomeNudges()`), surfaced as an "Your application progress" card in
      Insights + fed into the AI do-next prompt. Lights up as the worker writes signals.

## Phase 2 — Learning-to-Rank; demote the LLM (1–2 months)
- [x] **Shared feature extractor** (`lib/features.ts`) — one `extractFeatures()` used
      offline AND (later) online, so no train/serve skew. 18 numeric features:
      pred_score, breakdown, cosine, skill-overlap, seniority gap, location/remote fit,
      freshness, desired-role match, etc.
- [x] **Feature store** (`match_features`, migration 0015) + `npm run build-features` —
      materializes feature vectors + a GRADED label (2 hired / 1 opened-applied / 0
      ignored) from existing data. No Claude calls; safe to run nightly.
- [x] **Train the ranker** — `npm run train-ranker`: class-weighted logistic regression
      (pure TS, no Python) on `match_features`, standardized, train-AUC reported, saved to
      `ranker_model` (migration 0016). Trains on whatever exists; **auto-activates for
      serving only at ≥`RANKER_MIN_POS` (30) positives** so a noise model never ships.
- [x] **Serve the ranker** — `candidateJobs` Stage 2a loads the ACTIVE model and orders
      candidates by `rankerProb()` on PRE-LLM features (no train/serve skew), choosing
      which get an LLM call; Voyage rerank is the fallback until a model activates.
- [x] **Fully automated** — nightly cron now runs calibrate → build-features → train-ranker
      → eval, so the loop self-improves with zero manual steps once data flows.
- [ ] Once active: shrink the LLM-scored set (the ranker already picked the best) →
      LLM becomes the explainer on top ~10, ~4× cheaper. (Tune `SCORE_K` when AUC proves out.)

## Phase 3 — The "JUDE" move: distillation + learned embeddings (a quarter)
- [x] **Score distillation v1** — `npm run train-distill`: linear regression (pure TS) that
      learns to mimic Claude's 0-99 score from pre-LLM features. Teacher labels are the
      scores already in `match_features.pred_score`, so it trains TODAY (no engagement
      needed). Saved to `distill_model` (migration 0017); reports MAE/R² vs Claude.
- [x] **Distilled fallback served** — `getMatch` returns a clearly-labelled distilled
      ESTIMATE when Claude is unavailable (no key / transient error) instead of nothing;
      never cached, so the real score replaces it. Removes the "no key → no matches" cliff.
- [ ] Upgrade distill v1 → cross-encoder / GBT for accuracy; add a confidence band so we
      can SKIP the LLM on high-confidence cases (the real cost win at 1M).
- [ ] Fine-tune the embedding/two-tower on engagement pairs so *retrieval itself* is
      learned, not generic Voyage.
- [ ] Evaluate Matryoshka (truncatable) embeddings: cheap low-dim first pass, full-dim rerank.

## Phase 4 — Aim higher (our moat)
- [ ] **Two-sided marketplace matching**: optimize jointly for seeker fit × employer
      qualification × job liquidity (don't flood one posting). Assignment, not independent scores.
- [x] **Career-trajectory matching** — "reachable roles": `/insights` now returns
      `reachable` (stretch roles 1–3 learnable skills away, with the bridge) + `unlocks`
      (the single skill that unlocks the most reachable roles). Rendered as a "Roles
      within reach" card in Insights + fed into the AI do-next coach. No extra LLM calls.
- [ ] **Agentic sourcing & prep**: for a top match, research the company, draft an intro,
      build an interview plan.
- [ ] **Fairness audit as a feature**: extend the honesty rubric to an LLM-judge that
      flags prestige/demographic bias — a brand pillar for an Africa-first product.

## Success metrics (tracked by the eval harness)
- Apply-rate of top-5 matches ↑ · Recall@20 of eventually-applied jobs ↑
- Score↔apply correlation (higher scores really do convert) · % matches that are
  in-scope (pref-respecting) · LLM cost per active student ↓ at constant quality.
