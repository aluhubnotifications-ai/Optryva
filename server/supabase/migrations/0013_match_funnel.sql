-- Match funnel + student opportunity preferences.
--
-- Two things:
--  1. Student preferences — which OPPORTUNITY TYPES (Internship / Full-time / …)
--     and which COUNTRIES a student actually wants. A job outside those is not a
--     bad match, it's out of scope, so the matcher skips it entirely (never spends
--     an LLM call on it). Stored as JSON-text arrays to match the existing columns
--     (skills, desired_roles, …). Empty / null = "no restriction".
--  2. Scalability — at 1M live jobs we cannot LLM-score everything. This adds the
--     first two stages of the retrieval funnel IN POSTGRES: hard-filter by the
--     student's preferences AND rank by embedding similarity in one indexed query,
--     returning only the top-K candidates the server then reranks + LLM-scores.
-- Run in the Supabase SQL Editor.

-- 1) Preference columns (JSON-text arrays; backfilled from the old boolean flags).
alter table profiles add column if not exists pref_listing_types text; -- e.g. '["Full-time","Fellowship"]'
alter table profiles add column if not exists pref_countries     text; -- e.g. '["Rwanda","Kenya"]'

-- Carry the existing open_to_internship / open_to_fulltime intent forward so we
-- don't silently widen anyone's scope. Only write a restriction when the flags
-- actually exclude something; otherwise leave null (= all types).
update profiles
   set pref_listing_types = to_jsonb(
         array_remove(array[
           case when coalesce(open_to_internship, 1) = 1 then 'Internship' end,
           case when coalesce(open_to_fulltime, 1) = 1 then 'Full-time' end,
           case when coalesce(open_to_fulltime, 1) = 1 then 'Part-time' end,
           case when coalesce(open_to_fulltime, 1) = 1 then 'Fellowship' end
         ], null)
       )::text
 where user_type = 'student'
   and pref_listing_types is null
   and (open_to_internship = 0 or open_to_fulltime = 0);

-- 2) Upgrade the vector indexes ivfflat -> HNSW. HNSW gives stable recall without
-- per-corpus list tuning and stays fast into the millions of rows (ivfflat
-- lists=10 was sized for a demo catalog). Build is slower but query is what we run
-- on every match. m / ef_construction are the standard quality-vs-build defaults.
drop index if exists idx_jobs_embedding;
drop index if exists idx_profiles_embedding;
create index if not exists idx_jobs_embedding_hnsw
  on job_listings using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);
create index if not exists idx_profiles_embedding_hnsw
  on profiles using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);

-- Helps the hard-filter columns the funnel filters on before/with the ANN scan.
create index if not exists idx_jobs_status_type_country
  on job_listings (status, listing_type, country);

-- Stage 0+1 of the funnel: hard-filter (preferences) + similarity-rank, top-K.
--  • p_listing_types / p_countries null (or empty) => no restriction on that axis.
--  • Remote jobs always pass the country filter (location is irrelevant remote).
--  • When the student or a job has no embedding we can't rank it semantically, so
--    it still passes the filter and falls back to recency order (similarity null).
create or replace function match_candidate_jobs(
  p_student_id    text,
  p_listing_types text[] default null,
  p_countries     text[] default null,
  p_limit         int default 600
)
returns table (job_id text, similarity float)
language sql stable as $$
  with me as (select embedding from profiles where id = p_student_id)
  select j.id,
         case when (select embedding from me) is null or j.embedding is null
              then null
              else 1 - (j.embedding <=> (select embedding from me)) end as similarity
  from job_listings j
  where j.status = 'active'
    and (p_listing_types is null or array_length(p_listing_types, 1) is null
         or j.listing_type = any (p_listing_types))
    and (p_countries is null or array_length(p_countries, 1) is null
         or j.remote = 1 or j.country = any (p_countries))
  order by
    case when (select embedding from me) is not null and j.embedding is not null
         then j.embedding <=> (select embedding from me) end asc nulls last,
    j.created_at desc
  limit p_limit;
$$;
