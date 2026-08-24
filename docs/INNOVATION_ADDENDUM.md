# Optryva Innovation Addendum

**Companion to:** Optryva Build Blueprint (August 2026)
**Purpose:** Fold the six differentiation ideas into the existing blueprint so the
document itself becomes more innovative without breaking its architecture, fairness
rules, or ALU pilot scope. Each idea maps to a section already in the blueprint and
includes concrete rewrite text where it changes product behavior.

> Guiding principle preserved from the blueprint: AI may generate structured
> information and explanations; transparent rules and human review own the decision.
> Every innovation below strengthens **explainability**, **reusable evidence**, and
> **student agency** — the three bones already in the blueprint — rather than adding
> opaque automation.

---

## I. Summary of applied innovations

| # | Innovation | Blueprint section changed | Pilot-ready? |
| --- | --- | --- | --- |
| 1 | Gap-driven adaptive assessment | §6, §11 Phase 3, App. A | Yes (reuses matcher) |
| 2 | Readiness Trajectory Simulator | §7 skill-gap path, §14 demo | Yes (reuses scorer) |
| 3 | Portable Evidence Wallet (skills passport) | §9 entities, §6 reusable evidence, App. A | Post-pilot, stub now |
| 4 | Outcome-weighted opportunity ranking | §4 ranking formula, §13 metrics | Yes (uses Outcome entity) |
| 5 | Two-sided verification flywheel | §8 university workflow, §15 expansion | Yes (network effect) |
| 6 | "Show your work" explainability badge | §3 positioning, §16 backlog | Yes (marketing + UI) |

---

## II. Innovation 1 — Gap-driven adaptive assessment

**Why it is more innovative than a standalone test builder:** today §6 treats
matching and assessment as separate features. Coupling them turns the assessment
into *proof of the specific gap* the matcher found. The test is no longer generic;
it is the evidentiary closure of a known weakness.

**Change to §6.2 (Employer flow):** insert after step 4 ("Optryva proposes a short,
practical assessment and a draft rubric"):

> 4b. Optryva inspects the published essential requirements and the candidate pool's
> demonstrated evidence, then proposes assessment items that target the *specific
> gaps* most relevant to this role — for example, if stakeholder communication is the
> weakest evidenced essential skill across shortlisted candidates, the draft leads
> with one scenario question on that competency. The employer sees which requirement
> each question maps to and may remove or reassign any item.

**Change to §6.3 (Assessment design rules):** add a sentence to the first paragraph:

> Questions should be generated to close observed evidence gaps for the role, not
> drawn from a fixed generic bank, so the assessment measures what the match could
> not yet verify.

**Change to §11 Phase 3:** append to the Phase 3 deliverable row:

> Assessment drafts are gap-aware: the draft rubric is seeded from the role's
> essential requirements weighted by current candidate evidence weakness.

---

## III. Innovation 2 — Readiness Trajectory Simulator ("what-if")

**Why it is innovative and cheap:** the skill-gap path in §7 is a static list. Using
the *existing deterministic scorer* (the same transparent rules that produce the
match), a student can simulate "if I finish X and pass assessment Y, my fit moves
from Insufficient → Strong and I enter the Top 40." This is a high-demo-value feature
that reuses code we already have.

**New subsection to add at the end of §7 (after Skill-gap path):**

### 7.x Readiness Trajectory Simulator

Every significant gap should be actionable in simulation, not only in advice. The
student can mark a gap action as *planned* (complete a project, earn a certificate,
pass the role assessment, add a verified experience) and Optryva re-runs the
transparent matcher against the projected profile.

The simulator returns:

- the projected fit status after the action (for example, Insufficient → Potential);
- the projected change in requirement coverage;
- whether the opportunity would enter the student's Top 40; and
- the smallest set of actions needed to reach a Strong match for that role.

The simulation must always be labeled as a projection, never as a guaranteed
outcome, and must show which evidence items were assumed added.

**Change to §14 (demo flow):** add as step 5.5:

> The student opens the Readiness Trajectory Simulator on a target role, marks the
> recommended Tableau project as planned, and watches the fit status move from
> Insufficient evidence to Potential match and the role enter the Top 40.

---

## IV. Innovation 3 — Portable Evidence Wallet (skills passport)

**Why it is the real moat:** "reusable evidence" in §6 is currently scoped per
assessment reuse. Elevating it into a student-owned, consent-controlled **skills
passport** makes the verified skill travel to every employer without re-testing.
This directly serves the blueprint thesis "evidence that can be explained, improved,
and reused with consent."

**Change to §9 (data model):** add one entity:

| EvidenceWalletCredential | Student-owned, consent-controlled, versioned skill assertion linking one or more EvidenceItems, optionally conforming to W3C Verifiable Credentials / Open Badges. Reusable across employers with explicit consent. |

**Change to §6.7 (Reusable skills evidence):** append:

> In its matured form this becomes a Portable Evidence Wallet: a student-owned
> skills passport where one verified assessment or experience proves a skill once
> and is selectively shared with any suitable employer. The wallet is the durable
> asset; the job application is one of its uses.

**Pilot note:** stub the wallet schema now; full cross-employer portability is a
Phase 4+ item, but the data model should not block it later.

---

## V. Innovation 4 — Outcome-weighted opportunity ranking

**Why it is innovative:** §4 ranks by fit only. Adding a second, transparent signal
from the existing `Outcome` entity makes ranking a *learning system*: opportunities
where similar students were actually hired or progressed rank above equally-fitting
roles with no outcome history.

**Change to §4 (ranking formula):** revise the starting configuration to:

```
35% essential requirements
18% relevant experience and projects
14% verified or assessable evidence
13% stated preferences and feasibility
10% outcome-weighted opportunity ranking
10% résumé presentation and completeness
```

Add a sentence:

> Outcome weighting uses anonymized, aggregated placement and progression history
> for similar profiles and roles; it adjusts ranking only and never overrides the
> human review or the student's own preferences.

**Change to §13 (metrics):** add to Student metrics:

- trajectory-simulation use and planned-action completion rate.

---

## VI. Innovation 5 — Two-sided verification flywheel

**Why it is innovative:** it makes the network effect explicit as a product feature,
not an accident. The blueprint mentions verification in §8 and §10 but not the
loop that improves matching as both sides contribute.

**Change to §8.2 (Verification requirements):** add a closing paragraph:

> Verification is a flywheel, not a one-time gate. Universities verify
> opportunities and publish outcomes; employers verify skills through assessments;
> that verified data improves the next student's matching and gap analysis; better
> matches produce better outcomes, which earn more verification. Each side's
> contribution raises the other side's result quality.

**Change to §15 (expansion):** insert before the expansion sequence:

> Expansion is powered by the verification flywheel: the more institutions verify
> opportunities and the more employers verify skills, the stronger every subsequent
> match becomes, lowering acquisition cost per quality placement.

---

## VII. Innovation 6 — "Show your work" explainability badge

**Why it is innovative as positioning:** the blueprint bans unexplained "100% match"
badges (§14). Going further, turn source-cited explainability into a *marketed
certification* — a visible "Show your work" badge on every match and review.

**Change to §3 (positioning):** add a fourth promise line:

> **Shared promise:** Every match and review carries a "Show your work" badge —
> Optryva shows the exact evidence and rules behind each conclusion, by default.

**Change to §16 (backlog, Must build first):** add:

- "Show your work" explainability badge on matches and employer reviews;

**Change to §10 (minimum controls):** add to the audit list:

- a visible, per-match "Show your work" control that expands the evidence and
  rule version used for that conclusion.

---

## VIII. Integration checklist for the rebuild backlog

Add to §16 "Build next":

- gap-driven assessment draft (Innovation 1);
- Readiness Trajectory Simulator (Innovation 2);
- outcome-weighted ranking signal (Innovation 4);
- verification flywheel instrumentation (Innovation 5);
- "Show your work" badge (Innovation 6).

Add to §16 "Build after validation":

- Portable Evidence Wallet / skills passport (Innovation 3).

---

## IX. What this addendum does NOT change

- The prohibition on facial, emotion, accent, personality, or protected-class
  signals (§10) is unchanged.
- The human-decision-first architecture (§5) is unchanged; every innovation adds
  transparency or student agency, never autonomous hiring.
- The ALU pilot scope (§8) is unchanged; Innovations 1, 2, 4, 5, 6 are pilot-feasible,
  while 3 is deliberately phased.
- The "no unexplained score" rule (§A.7) is reinforced by Innovations 2, 4, and 6.
