-- Migration: Free-first cache-first matching engine
-- Adds the durable pair table, queue table, and config table for the
-- automatic + manual student-job-resume matching system.

-- match_candidates: one logical record per student-job-resume pair.
-- Holds deterministic filter points, versions, hard eligibility, and
-- the AI review result (when it has been reviewed).
create table match_candidates (
  id text primary key default gen_random_uuid()::text,
  student_id text not null references profiles(id) on delete cascade,
  job_id text not null references job_listings(id) on delete cascade,
  resume_id text not null references resume_profiles(id) on delete cascade,

  job_version text not null,
  resume_version text not null,
  preference_version text,
  filter_version text not null,

  eligibility_status text not null,
  exclusion_reasons jsonb not null default '[]'::jsonb,

  filter_points integer not null default 0,
  point_breakdown jsonb not null default '{}'::jsonb,
  semantic_similarity real,
  matched_skills jsonb not null default '[]'::jsonb,
  missing_skills jsonb not null default '[]'::jsonb,
  evidence_completeness real,
  rank_position integer,

  ai_status text not null default 'not_requested',
  ai_score integer,
  ai_quality integer,
  ai_confidence text,
  ai_payload jsonb,
  ai_model text,
  ai_prompt_version text,
  ai_scored_at timestamptz,
  ai_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  stale_at timestamptz
);

-- Status enum check constraints
alter table match_candidates
  add constraint match_eligibility_status_check
  check (eligibility_status in ('passed', 'excluded')),
  add constraint match_ai_status_check
  check (ai_status in ('not_requested', 'queued', 'processing', 'completed', 'failed', 'stale'));

-- Indexes for fast lookups
create index idx_match_candidates_student_resume on match_candidates(student_id, resume_id, eligibility_status, rank_position);
create index idx_match_candidates_job_eligibility on match_candidates(job_id, eligibility_status, filter_points desc);
create index idx_match_candidates_ai_status on match_candidates(ai_status, updated_at);
create index idx_match_candidates_job_resume_rank on match_candidates(job_id, resume_id, filter_points desc);
create index idx_match_candidates_stale on match_candidates(stale_at) where stale_at is not null;

-- Unique logical key: one row per student-job-resume pair (latest version).
-- We use a unique index on (student_id, job_id, resume_id) — re-evaluation
-- updates in place rather than inserting duplicates.
create unique index match_candidates_unique_pair on match_candidates(student_id, job_id, resume_id);

-- match_queue_jobs: durable queue control plane for AI review.
-- The Cloudflare Queue message contains minimal IDs + version hashes;
-- the consumer reads the full data from the DB and verifies versions.
create table match_queue_jobs (
  id text primary key default gen_random_uuid()::text,
  trigger text not null,
  student_id text references profiles(id) on delete cascade,
  job_id text references job_listings(id) on delete cascade,
  resume_id text references resume_profiles(id) on delete cascade,

  candidate_ids jsonb not null default '[]'::jsonb,
  input_hash text not null unique,
  priority integer not null default 50,
  status text not null default 'queued',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table match_queue_jobs
  add constraint match_queue_trigger_check
  check (trigger in ('new_job', 'job_updated', 'resume_updated', 'manual', 'refresh', 'rebuild')),
  add constraint match_queue_status_check
  check (status in ('queued', 'processing', 'completed', 'delayed', 'failed'));

create index idx_match_queue_status_priority on match_queue_jobs(status, available_at, priority desc);
create index idx_match_queue_job_status on match_queue_jobs(job_id, status);
create index idx_match_queue_student_status on match_queue_jobs(student_id, status);

-- matching_config: tunable parameters for the matching engine.
create table matching_config (
  id text primary key default 'default',
  auto_score_threshold integer not null default 70,
  auto_score_top_k integer not null default 10,
  max_groq_batch_size integer not null default 8,
  max_auto_pairs_per_job integer not null default 20,
  filter_version text not null default 'filter-v1',
  prompt_version text not null default 'match-prompt-v1',
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into matching_config (id, enabled) values ('default', true)
  on conflict (id) do nothing;

-- Helper function to update config with a new prompt/filter version and
-- invalidate affected candidate rows.
create or replace function match_invalidate_job(job_id text, new_version text)
  returns void language plpgsql as $$
begin
  update match_candidates
  set stale_at = now()
  where job_id = match_invalidate_job.job_id
    and job_version < new_version;
end;
$$;

-- Trigger to auto-update updated_at on match_candidates
create or replace function _update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_match_candidates_updated
  before update on match_candidates
  for each row execute function _update_updated_at();
