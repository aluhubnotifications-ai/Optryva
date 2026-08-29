-- § Phase 5 (Employer Assessment): persist the AI match rationale shown to reviewers.
-- At apply time we already copy match_score from ai_match_cache; this stores the
-- human-readable "why" (reasons + matched skills) so the employer can see the
-- evidence behind the fit score without re-scoring.
alter table applications
  add column if not exists match_rationale text;
