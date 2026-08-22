# Optryva Update Plan

**Date:** 2026-08-19
**Product:** Optryva
**Pilot focus:** African Leadership University (ALU)

## Product Direction

Optryva should become an explainable career-fit and skills-evidence platform, not a generic job board or invisible automated hiring system.

Core workflow:

> Fit -> Gap -> Path -> Resume -> Apply -> Review -> Outcome

The immediate goal is a reliable ALU pilot that helps students find relevant opportunities and helps employers review job-related evidence with human control.

## Current Foundation

Already available:

- Student, company, and school accounts
- ALU school profile and seeded opportunities
- Opportunity creation and editing
- School, year, student-domain, and privacy restrictions
- Applications and status pipeline
- Applicant review pages
- Messaging and notifications
- AI matching, sourcing, research, CV parsing, and career guidance
- Match caching and retrieval funnel
- Country, opportunity-type, remote, and role preferences
- Employer analytics
- External application tracking
- Outcome-monitoring infrastructure
- JWT access tokens and refresh cookies

## Phase 0: Stabilize Before Pilot

### Security fixes

- [x] Enforce application authorization on every read and write endpoint.
- [x] Ensure only the student, job owner, or authorized administrator can access an application.
- [x] Remove `cv_text` and `cv_url` from public profile responses.
- [ ] Add private document access with authorization checks.
- [ ] Move résumé and application files out of database data URLs where practical.
- [ ] Add upload size limits, file validation, and download auditing.
- [ ] Remove development JWT secret fallbacks in production.
- [ ] Separate demo, test, student, employer, school, and administrator accounts.
- [ ] Rotate shared demo passwords and production secrets before partner use.

### Reliability fixes

- [ ] Add timeout handling to login and API requests.
- [ ] Add visible error, retry, and offline states to important pages.
- [ ] Improve applicant detail loading with skeleton, error, and retry states.
- [ ] Add an application-level error boundary.
- [ ] Add backend health monitoring.
- [ ] Add automated authorization and privacy tests.
- [ ] Make database migrations reproducible in deployment.

### Performance and load-time fixes

The production client currently builds into one approximately 1.04 MB JavaScript
chunk (about 295 KB gzip) across 2,809 transformed modules. Browser Core Web
Vitals still need a real DevTools trace, but the build and startup code confirm
several load-time risks.

- [ ] Add route-level lazy loading and `Suspense` so the first screen does not download every page.
- [ ] Keep Recharts, admin pages, company pages, and AI-heavy panels out of the initial student bundle.
- [ ] Stop starting AI matching automatically from the dashboard; defer it to Opportunities, Insights, an explicit action, or browser idle time.
- [ ] Deduplicate dashboard and navigation API requests through a shared cache for jobs, applications, companies, and conversations.
- [ ] Stop refetching navigation badges on every pathname change; refresh from cached data on a controlled interval.
- [ ] Remove legacy `mockDb` code from the production API dependency graph where no longer needed.
- [ ] Replace the Google Fonts render-blocking stylesheet with a locally hosted font or `font-display: swap`.
- [ ] Replace service-worker cleanup reloads with a one-time versioned cleanup so normal startup cannot trigger a second page load.
- [ ] Measure LCP, FCP, TTFB, INP, CLS, TBT, and Speed Index with Chrome DevTools on desktop and mobile.
- [ ] Add a bundle-size budget and fail CI when the initial JavaScript or route chunks exceed the agreed limits.

Recommended order: route splitting, deferred AI matching, request deduplication,
service-worker cleanup, font loading, then bundle and Core Web Vitals budgets.

#### Implementation recommendations

- Use `React.lazy` for route pages in `client/src/app/router.tsx` and wrap the protected outlet with a small loading boundary.
- Keep the landing, login, register, and onboarding routes in the first-load chunk; load student, company, analytics, admin, and AI-heavy pages on demand.
- Move `Analytics` and other Recharts imports behind their route boundary so chart code is not downloaded by students or before the analytics page opens.
- Remove the dashboard-side `useMatchProgress.getState().run(...)` startup call and let the Opportunities or Insights action own matching.
- Add request deduplication or a small Zustand data cache so `AppShell`, `Dashboard`, and page components share jobs, applications, profiles, and conversations.
- Make navigation badge refresh independent of `location.pathname`; refresh on login, relevant mutations, and a longer background interval.
- Split or remove legacy mock helpers from `client/src/lib/api.ts` after confirming no production call site depends on them.
- Add `font-display: swap` or self-host the selected font and avoid making an external font stylesheet part of first paint.
- Change the service-worker cleanup in `client/src/main.tsx` to a versioned one-time migration and never reload on every startup check.
- Add `vite-bundle-visualizer` or equivalent reporting in CI, with an initial-entry budget of 350 KB gzip and a warning budget for route chunks.
- Test cold loads on a mid-range mobile profile and Slow 4G, then compare authenticated and logged-out startup separately.

### Security requirements before real ALU data

The recent authorization work protects application ownership and hides résumé
file contents from general profile responses. The following requirements are
still needed before using real student, employer, or university data.

- [x] Restrict application detail and status changes to the student, listing owner, or authorized administrator.
- [x] Keep `cv_text` and `cv_url` out of general profile responses.
- [ ] Create separate public, candidate-review, and private-owner profile response shapes.
- [ ] Remove email addresses from general profile lists and profile pages unless the viewer is authorized for that purpose.
- [ ] Require production JWT access and refresh secrets; fail closed when they are missing.
- [ ] Add refresh-token rotation, session identifiers, revocation, and password-change invalidation.
- [ ] Stop marking newly registered accounts as email-verified before ownership is proven.
- [ ] Load application identity fields from the authenticated student profile instead of trusting request-body name, email, school, and year values.
- [ ] Move résumé and application documents to private object storage with short-lived signed download URLs.
- [ ] Add server-side file type, MIME, size, content, and upload-count validation.
- [ ] Scan uploaded documents for malware and reject unsafe or unsupported files.
- [ ] Add download and access auditing for résumés, applications, and assessment evidence.
- [ ] Add rate limits and abuse controls for login, registration, password changes, uploads, applications, and AI endpoints.
- [ ] Replace or reduce localStorage access-token persistence and document the XSS threat model.
- [ ] Add consent records with purpose, policy version, timestamp, revocation, and reuse scope.
- [ ] Add correction, export, deletion, retention, and appeal workflows.
- [ ] Add authorization integration tests for students, employers, schools, and administrators.
- [ ] Add privacy tests proving one authenticated user cannot enumerate another user's private data.

### Country preference evaluation

Do not change the matching behavior yet. Evaluate an alternative country-preference
policy before implementation:

- [ ] Keep all countries eligible for retrieval and scoring when a student has country preferences.
- [ ] Treat preferred countries as a ranking and explanation signal rather than a hard exclusion.
- [ ] Keep hard eligibility restrictions separate, including school, year, work authorization, deadline, and explicit opportunity constraints.
- [ ] Preserve remote opportunities as country-flexible where the role supports remote work.
- [ ] Compare the current hard-country-filter policy with the proposed preference-boost policy.
- [ ] Measure qualified matches, applications, interviews, country distribution, and student usefulness ratings.
- [ ] Review whether students understand that a non-preferred-country role is being shown as an alternative.
- [ ] Decide the policy only after evaluation; no production matching change is included in this phase.

Do not use real ALU data in the pilot until the public-profile privacy boundary,
production secret checks, private document storage, rate limits, and authorization
tests are complete.

### Pilot readiness

- [ ] Use Optryva branding consistently.
- [ ] Create synthetic ALU demo data separate from real student data.
- [ ] Document data retention, deletion, correction, and export rules.
- [ ] Verify ALU account roles, organization identity, and listing ownership.

## Phase 1: Master Career Profile and Evidence

Build one source of truth for each student.

- [ ] Create `Master Career Profile` data model.
- [ ] Add structured education, skills, experience, projects, leadership, and certifications.
- [ ] Create an evidence library.
- [ ] Link résumé claims to evidence items.
- [ ] Track evidence status: verified, student-provided, extracted, suggested, missing, or conflicting.
- [ ] Store evidence source references and uncertainty flags.
- [ ] Add correction and confirmation workflow for parsed information.
- [ ] Add consent-controlled evidence sharing.

## Phase 2: Multiple Résumé Profiles

A student should have multiple truthful career directions in one account.

- [x] Add `ResumeProfile` records linked to one student.
- [x] Support résumé names, target roles, industries, locations, work modes, and opportunity types.
- [x] Support create, edit, pause, and delete.
- [ ] Add compensation, availability, exclusions, duplicate, preview, download, archive, and restore.
- [ ] Add résumé version history.
- [ ] Show which résumé versions and evidence are affected when the master profile changes.
- [ ] Preserve the exact résumé version submitted with every application.
- [ ] Add an application archive showing résumé, evidence, and preference snapshot.

Initial ALU résumé directions:

- Data and Analytics
- Product and Technology
- Operations and Leadership

## Phase 3: Fixed-40 Résumé-Aware Matching

The default all-résumé experience must return no more than 40 de-duplicated opportunities.

- [ ] Score each eligible opportunity against every active résumé.
- [ ] Apply résumé-specific preferences before ranking.
- [ ] Allocate results across active résumés.
- [ ] Start with balanced allocation: `40 / active résumé count`.
- [ ] Redistribute unused slots to strong remaining matches.
- [ ] Remove duplicate opportunities from the overall list.
- [ ] Support All Résumés, One Résumé, and Selected Résumés modes.
- [ ] Support Balanced View and Best Opportunities View.
- [ ] Show the résumé responsible for every result.
- [ ] Add Compare Résumés for the same opportunity.
- [ ] Preserve preference snapshots for historical applications.
- [ ] Explain why results changed after preference updates.

Each match should store:

- Student ID
- Résumé ID
- Opportunity ID
- Preference snapshot
- Requirements result
- Evidence result
- Preference and feasibility result
- Fit status
- Score and matching version
- Explanation
- Recommended next action
- Calculation timestamp

## Phase 4: Explainable Match Experience

Replace opaque scores with evidence-linked explanations.

- [ ] Show Strong Match, Potential Match, and Insufficient Evidence statuses.
- [ ] Show essential requirements met.
- [ ] Show preferred requirements met.
- [ ] Show trainable and missing requirements.
- [ ] Show evidence supporting each requirement.
- [ ] Show preference and feasibility fit.
- [ ] Show evidence confidence and uncertainty.
- [ ] Show résumé presentation quality separately from full-profile fit.
- [ ] Show readiness: Apply now, Prepare then apply, or Build toward role.
- [ ] Label Claude scores, ranker scores, and distilled estimates clearly.
- [ ] Show matching version and scoring dimensions.
- [ ] Add student correction controls.

Target match dimensions:

- Essential requirements
- Preferred requirements
- Relevant experience and projects
- Verified or assessable evidence
- Preference fit
- Feasibility
- Evidence confidence
- Résumé presentation
- Readiness

## Phase 5: Employer Assessment MVP

Start with a simple employer-approved assessment workflow.

### Employer setup

- [ ] Add assessment timing: During application, Before interview, or No assessment.
- [ ] Allow job descriptions and role documents as sources.
- [ ] Extract essential, preferred, and trainable requirements.
- [ ] Show source document and section for extracted requirements.
- [ ] Add Generate Assessment Draft action.
- [ ] Support three initial templates: work sample, scenario judgment, and written communication.
- [ ] Support 3, 5, or 8 questions.
- [ ] Support 10, 20, 30, or 45-minute limits.
- [ ] Add allowed tools and accessibility settings.
- [ ] Generate an editable rubric with every question.
- [ ] Allow edit, regenerate, reorder, duplicate, and delete per question.
- [ ] Require explicit employer approval before publishing.

### Candidate experience

- [ ] Show AI-use, criteria, timing, tools, accommodation, and human-review notice.
- [ ] Add separate assessment consent.
- [ ] Add mobile-friendly low-bandwidth assessment page.
- [ ] Add autosave and resume-after-interruption.
- [ ] Add accommodation request flow.
- [ ] Add final answer review.
- [ ] Add timestamped submission receipt.
- [ ] Explain next steps after submission.

### Review and results

- [ ] Evaluate only submitted evidence against the approved rubric.
- [ ] Show answer evidence, rubric references, scores, confidence, and uncertainty.
- [ ] Add human review and override controls.
- [ ] Require an override reason.
- [ ] Add assessment version and rubric version locking.
- [ ] Store model, prompt, rubric, source, submission, and reviewer versions.
- [ ] Add candidate challenge and human-review request.
- [ ] Create reusable, consent-controlled skill evidence records.

## Phase 6: University and ALU Operations

- [ ] Add verified institutional profile management.
- [ ] Add staff roles and least-privilege permissions.
- [ ] Add student cohort and program controls.
- [ ] Add employer verification workflow.
- [ ] Add opportunity approval and source-link controls.
- [ ] Add institutional aggregate analytics.
- [ ] Add recurring skill-gap reporting without unnecessary personal exposure.
- [ ] Add applications, interviews, offers, and placement exports.
- [ ] Add ALU pilot configuration and reporting.

Suggested ALU pilot:

- 30-100 volunteer students or recent graduates
- 5-10 verified employers or partners
- Internships, fellowships, graduate roles, and projects
- Two or three role families
- Four to six weeks
- Consent-based data collection

## Phase 7: Outcomes, Fairness, and Evidence Network

- [ ] Track interview, offer, placement, rejection, withdrawal, and retention outcomes.
- [ ] Add score-to-application and score-to-interview evaluation.
- [ ] Add résumé performance analytics.
- [ ] Add assessment performance analytics.
- [ ] Add time-to-review and time-to-decision analytics.
- [ ] Add human override-rate tracking.
- [ ] Add extraction accuracy and evidence-linking evaluation.
- [ ] Add false-positive and false-negative analysis.
- [ ] Add accommodation impact checks.
- [ ] Add fairness review before expanding to employment-impacting workflows.
- [ ] Add reusable evidence across employers only with consent.

## Data Entities To Add

- `ResumeProfile`
- `ResumeVersion`
- `EvidenceItem`
- `EvidenceLink`
- `RoleRequirement`
- `ResumeMatch`
- `Assessment`
- `AssessmentQuestion`
- `AssessmentRubric`
- `AssessmentAttempt`
- `AssessmentResult`
- `HumanReview`
- `ConsentRecord`
- `AuditEvent`
- `OpportunityVerification`
- `Outcome`

## Engineering Decisions (built, pending deploy)

### D1 — Re-matching after a student edits their résumé (won't kill the system)

**Problem:** a student gets matches, notices gaps in their fit, edits the résumé,
and wants fresh scores. Naively re-scoring every role on every save would
stampede the Claude scorer.

**Decision:**
- Matching stays **lazy + cached**. Editing a résumé only sets `stale = 1` on the
  student's `ai_match_cache` rows (`server/src/routes/profiles.ts`) — it never
  recomputes anything. Re-scoring happens on-demand, and only the *real* Claude
  score is cached (a distilled estimate is shown but never cached, so it is
  replaced the instant Claude is available).
- Add an explicit, **bounded** "Refresh scores" action: `POST /ai/matches/refresh`
  re-scores only the student's *existing* cache rows (their already-matched roles),
  with a **concurrency cap of 3**, and writes the new current-engine score back
  (`stale = 0`). This is the safe answer to "do I need to re-match?": yes, but only
  your existing matches — not the whole catalog.
- The full "Re-run" (re-discovery funnel) stays available but is heavier; it is
  concurrency-capped at 5 on the server. "Refresh scores" is the recommended path
  after a CV edit.
- Client: `aiApi.refreshMatches()` + `useMatchProgress.refresh()`; a "Refresh
  scores" button sits next to "Re-run" in the student Insights → Matches tab.

### D2 — Employer AI judges a candidate on their previous (match) score

**Problem:** the employer's review AI (`scoreAssignmentWithAI`) only scored the
submitted assessment. It re-derived nothing from the candidate's already-computed
fit, wasting a prior and risking inconsistent judgments.

**Decision:**
- The stored `match_score` + `match_rationale` (captured at apply time, migration
  `0028_application_match_rationale`) are passed into `scoreAssignmentWithAI` as a
  **fit prior**. The AI is instructed to treat that prior as the basis for role-fit
  and to only *freshly evaluate the submitted assessment* against the rubric —
  reconciling the two (confirm/contract) rather than re-deriving fit from scratch.
- This keeps the human as the final decision authority (override + required reject
  reason + audit are unchanged) and makes the AI suggestion consistent and cheaper.
- Cross-employer outcome history (prior rejections/hires elsewhere) is **out of
  scope** — it is a fairness/privacy concern and must not silently influence a new
  employer's view without explicit consent.

### D3 — Students can see their own assessment score + feedback

**Decision:** a student may view the AI-assisted evaluation of **their own**
submitted assessment, because it supports the platform's explainability and
learning mission and is fairer than a hidden, untraceable score.

Guardrails (implemented):
- Shown **only after the employer has reviewed** — gated on `assignment_score !=
  null` (the employer ran the AI review). It never appears for other candidates.
- Clearly labelled **advisory**: the panel states it is one input the employer
  used, and the human decision (status badge + employer note at the top) is the
  actual verdict and may differ.
- Surfaced in the student's `ApplicationDetail` page (score ring + recommendation
  + overall feedback + per-question feedback reconciled to the real question/rubric
  text). A subtle "Scored" badge on the `Applications` list signals availability.
- Authorization is unchanged: `GET /applications/:id` already allows only the
  owner student, the job's company, or an admin.

### D4 — Listings & applications stay cached across navigation (no reload on return)

**Decision:** the company "Listings & applications" page must not refetch (or flash
a loading state) every time the user navigates back to it — e.g. after opening an
applicant.

Implementation:
- A session-level Zustand store (`client/src/lib/companyData.ts`) holds the
  company's `jobs` + `apps` + `opens` in memory for the whole session.
- `Listings.tsx` reads from the store instead of local `useState`. On mount it
  calls `load()` which returns **instantly if already loaded** (no spinner, no
  network) and only **silently revalidates** when the data is older than 60s.
- The read API calls were already cached at the request layer (`jobs:company`,
  `apps:company`, `jobs:opens`, 60s TTL) and invalidated on mutations.
- Mutations in `ApplicantView` (status change, AI score, override, note) call
  `useCompanyData.invalidate()` so returning to the list silently refreshes with
  the new state — no stale "pending" badge.
- Different-account / re-login resets the store via a `userId` guard.

## Non-Negotiable Product Rules

### D6 — Mistral as the assessment-generation provider (smartest model)

**Decision:**
- Assessment **generation** (`POST /assignment/generate`) now runs on **Mistral**
  using `mistral-large-latest` (Mistral's smartest model; override via `MISTRAL_MODEL`).
- Provider order: **Mistral → Claude → deterministic template**. If `MISTRAL_API_KEY`
  is set, Mistral designs the assignment; if Mistral is unavailable it falls back to
  Claude; if neither key is set it returns the canned template. Mistral Large is
  text-only, so uploaded images/PDFs are noted as "not readable" and the model designs
  from the role context + any extracted text.
- `server/src/lib/mistral.ts` is the client (`mistralJsonBlocks` mirrors the Claude
  `claudeJsonBlocks` signature; returns null on any failure so callers fall back).
- Key: `MISTRAL_API_KEY` (local `.env`; production `wrangler secret put MISTRAL_API_KEY`).
  Usage is metered via the existing `recordUsage` (priced at 0 until added to `MODEL_PRICING`).

### D5 — Student GPA + poster country with opportunity-country lock

**Decision:**
- Students can record a **GPA in any format** (free text — e.g. `3.8/4.0`,
  `Second Class Upper`) on their profile. Stored as `profiles.gpa`; only the
  student edits/sees it on their own profile (not surfaced to employers unless
  we later choose to).
- Company and school accounts have a **`country`** on their profile. When creating
  an opportunity:
  - **Companies are locked** to their own profile country (the Country field is
    disabled in the listing editor) — they post their own opportunities.
  - **Schools may choose any country** per opportunity (the field is editable).

Implementation:
- Migration `0029_profiles_country_gpa.sql` adds `country` + `gpa` (nullable).
  (Also renamed the stray `0023_backfill_first_resume.sql` → `0025_…` to fix a
  `schema_migrations` primary-key collision with `0023_ai_assignments.sql`.)
- `server`: `country`/`gpa` added to the profile EDITABLE allow-list and to
  `rowToProfile`; `country` added to the directory `LIST_COLUMNS`.
- `client`: `Profile` type gains `country?`/`gpa?`. Student `Profile.tsx` gets a
  free-text GPA field. `CompanyProfile.tsx` gets a Country selector (both company
  and school). `JobEditor.tsx` defaults the listing Country from the poster's
  profile and disables it for companies.

- AI must not invent résumé experience or evidence.
- AI must not make an untraceable final hiring decision.
- Employers retain final human decision authority.
- Students control résumé and evidence sharing.
- Every application preserves the exact résumé and evidence submitted.
- Assessments must be job-related, accessible, time-limited, and approved by the employer.
- No facial analysis, emotion detection, accent scoring, attractiveness, personality inference, or protected-trait scoring.
- Do not show unexplained 100% match badges.
- Use synthetic data for demonstrations and rotate shared credentials.

## Recommended Immediate Sprint

1. Fix application authorization.
2. Fix résumé exposure in profile serialization.
3. Add document privacy and upload validation.
4. Add retry/error states for authentication and applicant detail.
5. [x] Add `ResumeProfile` database migration and API.
6. [x] Add résumé library UI.
7. [x] Add résumé-specific preferences.
8. Add exact résumé version to applications.
9. Implement fixed-40 de-duplication and attribution.
10. Add evidence-linked match explanations.

## Demo Story

1. Student opens the Master Career Profile.
2. Student creates Data, Product, and Operations résumé profiles.
3. Optryva returns a balanced maximum of 40 opportunities.
4. Student opens a role and sees matched résumé, requirements, evidence, gaps, and next action.
5. Student approves a résumé and applies.
6. Employer reviews the submitted résumé and evidence.
7. Employer sends a short approved assessment.
8. Student completes it and receives a submission receipt.
9. Employer reviews rubric-linked evidence and records a human decision.
10. ALU sees aggregate engagement and outcome metrics.

## Success Criteria For ALU Pilot

- Students can create at least three résumé profiles.
- The default all-résumé search returns at most 40 de-duplicated opportunities.
- Every result identifies the résumé and evidence used.
- Applications preserve résumé and preference snapshots.
- Employers can publish and review a simple assessment.
- Candidates receive clear notices, consent, autosave, and submission receipts.
- Employers can override AI recommendations and record reasons.
- Unauthorized users cannot access applications or private documents.
- ALU can view aggregate applications, interviews, offers, and placement metrics.
- Students and employers report that explanations are understandable and useful.
