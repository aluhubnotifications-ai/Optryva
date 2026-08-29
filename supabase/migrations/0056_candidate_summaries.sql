-- Persist candidate evidence summaries (profile-wide + job-scoped) so they
-- survive Worker restarts and are regenerated only when evidence changes.
create table if not exists public.candidate_summaries (
  student_id     text         not null references public.profiles(id) on delete cascade,
  job_key        text         not null default '',   -- '' = profile-wide; else hash(jobDescription)
  summary        text         not null,
  evidence_hash  text         not null,              -- stale check: hash of current evidence
  generated_at   timestamptz  not null default now(),
  primary key (student_id, job_key)
);

-- Make re-generation cheap: look up all summaries for a student at once.
create index if not exists idx_candidate_summaries_student on public.candidate_summaries(student_id);
