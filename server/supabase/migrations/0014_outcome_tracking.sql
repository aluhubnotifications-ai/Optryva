-- Outcome tracking — the closed data loop (our unfair advantage).
--
-- When a student clicks "Apply" on an external listing we log an INTENT, snapshot
-- the score we gave, and schedule a background check 14 days out. A separate
-- worker then looks for evidence of progress (e.g. a linked GitHub gaining
-- relevant activity, a profile headline change) and writes it back here. That
-- (predicted score -> real outcome) loop is what trains the matcher on data no
-- competitor has.
--
-- IMPORTANT — consent & compliance:
--   • Monitoring is OPT-IN per student (profiles.monitoring_consent). The worker
--     RPC below only ever returns students who opted in.
--   • GitHub checks use the official public API on a URL the student linked — fine.
--   • LinkedIn forbids automated scraping in its ToS. Do NOT scrape it. If you
--     monitor LinkedIn at all, do it via official APIs / user-initiated OAuth
--     re-auth, gated on the same consent. The schema is source-agnostic so the
--     compliant sources slot in without change.
-- Run in the Supabase SQL Editor.

-- Per-student opt-in for behind-the-scenes outcome monitoring.
alter table profiles add column if not exists monitoring_consent integer not null default 0;

-- One tracked outcome per (student, job) the student showed intent on. This is the
-- "matches table with a check_at" the worker polls.
create table if not exists match_outcomes (
  student_id      text not null references profiles(id) on delete cascade,
  job_id          text not null references job_listings(id) on delete cascade,
  source          text not null default 'external_link', -- how the intent was made
  score_at_intent integer,                                -- the match score when they clicked
  first_intent_at text not null,
  intent_count    integer not null default 1,
  -- monitoring state machine: monitoring -> profile_updated | likely_hired | closed | opted_out
  status          text not null default 'monitoring',
  check_at        timestamptz not null,                   -- when the worker should next look (intent + 14d)
  last_checked_at text,
  check_count     integer not null default 0,
  signals         jsonb not null default '{}'::jsonb,     -- what the worker found (github activity, role change, …)
  created_at      text not null,
  updated_at      text not null,
  primary key (student_id, job_id)
);

-- The worker scans by due time + status; this index keeps that O(due rows).
create index if not exists match_outcomes_due_idx on match_outcomes (check_at) where status = 'monitoring';

-- The ONLY query the background worker should run to find work. Returns outcomes
-- that are due, still monitoring, and whose student OPTED IN — joined with the
-- public profile URLs the worker is allowed to check. No consent => never returned.
create or replace function due_outcome_checks(p_limit int default 100)
returns table (
  student_id text,
  job_id     text,
  github     text,
  linkedin   text,
  status     text,
  check_count int,
  signals    jsonb
)
language sql stable as $$
  select o.student_id, o.job_id, p.github, p.linkedin, o.status, o.check_count, o.signals
  from match_outcomes o
  join profiles p on p.id = o.student_id
  where o.status = 'monitoring'
    and o.check_at <= now()
    and p.monitoring_consent = 1
  order by o.check_at asc
  limit p_limit;
$$;
