-- Enforce one application per student per job at the database level.
-- The API already blocks the common re-apply case, but concurrent submits
-- (two near-simultaneous requests) could otherwise both pass the read-then-
-- insert check and create duplicates. This unique index makes that impossible.
-- Drafts reuse the same row via UPDATE (the draft route upserts by
-- student_id + job_id), so this does not interfere with save/resume-draft.
create unique index if not exists applications_student_job_unique
  on public.applications (student_id, job_id);
