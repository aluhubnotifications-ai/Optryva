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

## Non-Negotiable Product Rules

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
