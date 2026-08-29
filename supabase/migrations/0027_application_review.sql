-- § Phase 5 (Employer Assessment): application review + human decision trail.
-- AI may suggest a score and a recommendation; the final decision is always human
-- and is recorded (who, when, why) so it can be audited.
alter table applications
  add column if not exists match_score integer,
  add column if not exists assignment_score integer,
  add column if not exists assignment_ai_feedback text,
  add column if not exists ai_recommendation text,
  add column if not exists decision_by text,
  add column if not exists decision_reason text,
  add column if not exists decided_at text;
