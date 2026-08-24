-- The status vocabulary grew to five values (plus a legacy "verified").
-- Update the column check constraint to allow them all.
alter table public.evidence_items drop constraint if exists evidence_items_status_check;
alter table public.evidence_items add constraint evidence_items_status_check
  check (status = any (array[
    'self_reported',
    'ai_analyzed',
    'student_approved',
    'supervisor_verified',
    'employer_verified',
    'verified'
  ]));
