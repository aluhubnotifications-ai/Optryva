-- Apply-first assessment flow: the application is submitted first, then the
-- proctored test is taken afterwards. These columns track when the candidate
-- becomes eligible for the test, when they actually submitted it, and whether
-- they were late (past the employer-set window).
alter table applications
  add column if not exists test_eligible_at timestamptz,
  add column if not exists assignment_submitted_at timestamptz,
  add column if not exists assignment_late boolean not null default false;
