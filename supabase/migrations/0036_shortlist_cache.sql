-- Cache for the employer Smart Shortlist so it is not recomputed on every open.
-- Only NEW applicants are scored on the fly (their match is written to ai_match_cache);
-- existing applicants reuse their cached match. A full re-score happens only when the
-- employer explicitly requests a rescore (which forces getMatch for every applicant).
create table if not exists public.shortlist_cache (
  job_id        text primary key references public.job_listings(id) on delete cascade,
  payload       jsonb not null,
  total         integer not null default 0,
  scored        integer not null default 0,
  engine_version integer not null default 1,
  mistral       boolean not null default false,
  computed_at   timestamptz not null default now()
);

create index if not exists shortlist_cache_computed_idx on public.shortlist_cache (computed_at);
