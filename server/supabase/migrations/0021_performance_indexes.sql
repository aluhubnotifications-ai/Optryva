-- Performance indexes for the hottest dashboard / messaging / jobs reads.
-- All additive (IF NOT EXISTS) so they're safe to apply on an existing DB.

-- Conversations thread scan: eq(thread_id) + eq(deleted) + order(created_at).
create index if not exists idx_msgs_thread_del_created
  on messages (thread_id, deleted, created_at);

-- DM-scoped conversation lookup: eq(scope) + order(created_at).
create index if not exists idx_msgs_scope_created
  on messages (scope, created_at);

-- Prefix LIKE on thread_id (e.g. 'u_xxx__*') needs text_pattern_ops to use
-- the index; this speeds the "threads involving me" participant filter.
create index if not exists idx_msgs_thread_pattern
  on messages (thread_id text_pattern_ops);

-- Jobs list: eq(status) + order(created_at desc).
create index if not exists idx_jobs_status_created
  on job_listings (status, created_at);

-- Follows-by-student (nav badges / dashboard follows).
create index if not exists idx_follows_student
  on company_follows (student_id);
