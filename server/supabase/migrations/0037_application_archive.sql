-- Soft-delete / archive for applications. When an employer "deletes" an application
-- it is archived (archived_at set) rather than hard-deleted, so the candidate's
-- documents and decision history are preserved and can be restored or permanently
-- removed later. Active employer listings filter out archived rows by default.
alter table if exists public.applications
  add column if not exists archived_at timestamptz;

create index if not exists applications_archived_idx
  on public.applications (job_id, archived_at);
