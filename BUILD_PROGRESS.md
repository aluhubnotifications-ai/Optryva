# Optryva Rebuild — Build Progress Tracker

> **Workflow (agreed):** Build **one page at a time** against hardcoded mock data.
> After each page, the app runs so the user can **see the result**, then says
> "continue" to move to the next page. Backend (Phase B) comes only after all
> pages are approved. Full plan: `~/.claude/plans/cosmic-leaping-mango.md`.

Legend: `[x]` done · `[~]` in progress · `[ ]` pending

---

## Foundation (done — needed before any page renders)
- [x] Build config (vite, ts, tailwind, postcss), index.html, favicon
- [x] Design tokens + globals.css (light/dark)
- [x] lib/utils, types, theme provider
- [x] UI primitives (Button, Card/Badge/Input/Select/Avatar/Progress/Skeleton, Modal, Tabs, Toast)
- [x] Mock DB seed (data/mockDb.ts)
- [x] Mock API client + AI generators (lib/api.ts)
- [x] Session/auth store (lib/store.ts)
- [x] AppShell (sidebar/topbar/mobile nav), Logo
- [x] Router + main.tsx
- [x] Placeholder pages so router compiles + `npm install` + dev server boots (tsc clean, HTTP 200)

---

## Pages — one at a time (review after each)

1. [x] **Dashboard** (student + company, role-aware; AI Research on Top Picks)
2. [x] **Jobs board** — redesigned to **master-detail layout** per user screenshot:
       top quick-filter tabs (For You / Tech / Finance / Product / Remote / Internships /
       Contract), left checkbox filter rail (type/location/salary/experience), middle
       AI-matched list (score pill + Trending), right detail pane with **AI Match Analysis
       breakdown bars** (skills/experience/location/compensation), About + Requirements,
       Apply now + Save, full AI research drawer. Mobile = list → detail drawer.
   - Theme switched to **orange brand**, default **light mode** (per screenshot)
   - AppShell: topbar **search bar** + sidebar **nav count badges**
   - New shared: `ui/Drawer`, `AIResearchPanel`; `MatchBreakdown` added to AiMatch
   - Layout **widened** (main max-w 1600px) so the 3-pane Jobs view spreads bigger
   - **Interactive AI Research**: user *describes/asks* anything about the role/company
     (free-text + suggested chips) → AI answers in a chat thread (`aiApi.researchAsk`),
     alongside fit score + company research. Drawer widened to `xl`.
   - Board now titled **"Opportunities"**: internships + full-time + fellowships/part-time,
     24 seed listings across US/UK/DE/KE/NG/ZA/IN/SG + Remote. **Type segmented control**
     (All / Internships / Full-time / Opportunities) + field tabs + Remote + Trending.
   - **Removed the left filter rail** (lean two-pane: list + detail).
   - **Country selector in navbar** (`lib/geo.ts`, flags) filters the list by country.
   - **Sticky panes**: tabs stick under topbar; list + detail each sticky with independent
     scroll (`lg:sticky top-[7.5rem] h-[calc(100vh-9rem)] overflow-y-auto`).
   - **AI Sourcing (Accio-style)** now lives in the **navbar search bar** (global):
     typing a description + "Find with AI" opens the global `AISourcingPanel` drawer that
     *finds & ranks* matching listings with per-result reasoning
     (`aiApi.sourceOpportunities` parses remote/country/type/pay/field/skills) + a
     conversational refine input. Results "View" deep-links to `/app/jobs?job=<id>`
     (Jobs reads the param to select/open). State in `lib/sourcing.ts`; panel mounted once
     in AppShell. Two AI surfaces: per-job research drawer + navbar describe-to-find.
   - **Full job description** for every listing (`lib/jobContent.ts` generates Benefits,
     "great fit if", company intro, Responsibilities, Qualifications, WFH note, work mode,
     Report link) so each role reads like a real posting. AI Match Analysis is collapsible.
     Apply button = "Quick Apply" (in-app) / "Apply on site" (external).
   - Country selector includes **Rwanda + more countries disabled ("Soon")**.
3. [~] Job Detail — covered by the rich inline detail pane on the Jobs board; dedicated
       `/app/jobs/:id` route still a stub (deep-link uses `/app/jobs?job=<id>` instead).
4. [x] **Apply Modal (+ AI Application Coach)** — `ApplyModal`: prefilled form, multi-file
       drag-drop uploads (CV required + optional docs), embedded 3-stage coach
       (draft → critique → final, "use this"), submit creates application. Wired to Quick Apply.
5. [x] **Applications list** — status filters w/ counts, cards with `AppProgressSteps`.
6. [x] **Application Detail** — header + pipeline, actions (Message / AI Research / Withdraw),
       timeline, cover note, submitted documents, withdraw confirm modal.
   - New shared: `AppProgressSteps`, `ApplyModal`.
7. [x] **AI Insights** — tabs: Chat (markdown render via `Markdown`), Job Matches (cache
       reader, score rings + tips), CV Tips (on-demand). 
8. [x] **Career Compass** — guided interview chat → AI recommend (3 ranked recs w/ why +
       stretch + actions) → one-page prep plan modal (`aiApi.compassInterview/Recommend/Prep`).
9. [x] Messages (Application + DM threads: list, conversation, send, reactions, delete, deep-link)
10. [REMOVED] Skills Marketplace — out of scope (not job/opportunity related)
11. [REMOVED] Resources Marketplace — out of scope
12. [REMOVED] Housing Board — out of scope
13. [REMOVED] Relocation Guide — out of scope
    > Scope narrowed to jobs/opportunities/internships only. Nav, routes, and page files
    > for Skills/Resources/Housing/Relocation deleted. (Mock data + unused api fns left in place.)
14. [x] Notifications — typed list, mark read / mark all, deep-link routing.
15. [ ] Student Profile (+ Account & Security)
16. [ ] Billing / Plan + mocked checkout + Payment History
17. [x] Company Dashboard (role-aware, in `Dashboard.tsx`)
18. [x] Company My Listings + **Create/Edit Listing modal** (apply-mode toggle, allowed-years,
        country, school "from another company" forwarding) + per-listing applicants page.
19. [x] Company Applicant View (profile/contact/docs + status pipeline controls + message)
20. [x] Company Analytics (KPIs, hiring funnel, 6-week trend, per-listing — Recharts)
21. [x] Company Profile (cover/logo, industry/size, links, plan badge, school variant)
22. [~] Landing + Auth + Onboarding — functional (auth screens + landing done; onboarding is a
        working stub). Billing intentionally skipped per user.
    - New: `company/ListingApplicants`, `company/ApplicantView`, `company/Analytics`,
      `company/Listings`, `company/CompanyProfile`.

---

### Added later (audience controls + follow)
- [x] **School/company audience restriction**: listings can restrict by **year** AND now by
      **school/university** (`allowed_schools`). Enforced server-side-style in `jobsApi.list`;
      editable in the Create Listing modal; shown as a badge on listing cards.
- [x] **Companies directory** (`/app/companies`) + **public company profile** (`/app/companies/:id`):
      students browse employers/schools, **Follow/unfollow**, toggle **email alerts**, see open
      roles + reviews. Following → in-app + email notification on each new listing
      (`jobsApi.create` already fans out to followers). New nav item "Companies".

### Real match engine + runnable demo
- [x] **`lib/matching.ts`** — pure, dependency-free deterministic match engine implementing
      spec §8.1: résumé-term coverage (42), skills∩tags (12), desired-role (+10), industry (+8),
      location (+8), base floor 20, **completeness cap** (no CV→60, thin→80, full→99). Produces
      score + 4-part breakdown + matched_skills + reasons + flags + tip. `aiApi.match` now calls it.
- [x] **`scripts/run-matching.mts`** + `npm run match [studentId]` — runs the engine over mock data,
      applies year/school visibility, prints a ranked, explained report. (Uses `tsx`.)

## Phase A — Verification (after all pages)
- [ ] `npm run build` passes, `tsc --noEmit` clean
- [ ] Walk all flows in light + dark, desktop + mobile

## Phase B — Backend (in `server/`, runnable — see server/README.md)
- [x] Express + TS + **SQLite** (better-sqlite3), schema + auto-seed
- [x] Auth (JWT access + httpOnly refresh cookie, bcrypt 12, full account lifecycle)
- [x] Core data APIs — profiles, jobs (**server-side year + school gating**), applications,
      follows, ratings, notifications, messaging
- [x] AI routes — **Claude `claude-opus-4-8`** + deterministic/canned fallback (match cache
      + 0.8/0.2 blend + completeness cap + staleness, sourcing, research, chat, coach, compass)
- [x] Verified: tsc clean; boots; login→jobs(10)→AI match/source all return 200
- [ ] Payments (Stripe) / Email (Resend) / Realtime — deferred
- [ ] Swap client `lib/api.ts` mock → real fetch (signatures already match)
