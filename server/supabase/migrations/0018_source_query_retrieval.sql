-- Query-driven retrieval for AI Sourcing / search (roadmap: scale the /source path).
--
-- The student's natural-language search ("remote Python internship in Kenya") is
-- embedded as a QUERY vector; this RPC ANN-ranks active jobs by similarity to that
-- vector + hard filters, returning the top-K — so search never scans the whole
-- catalog. Mirrors match_candidate_jobs (0013) but keyed on an arbitrary query
-- vector instead of the student's stored embedding.
-- Run in the Supabase SQL Editor.

create or replace function match_jobs_by_vector(
  p_embedding     text,                          -- bracketed vector literal '[..]'
  p_listing_types text[] default null,
  p_countries     text[] default null,
  p_remote        boolean default false,         -- true => only remote roles
  p_limit         int default 200
)
returns table (job_id text, similarity float)
language sql stable as $$
  select j.id, 1 - (j.embedding <=> p_embedding::vector) as similarity
  from job_listings j
  where j.status = 'active'
    and j.embedding is not null
    and (p_listing_types is null or array_length(p_listing_types, 1) is null
         or j.listing_type = any (p_listing_types))
    and (p_countries is null or array_length(p_countries, 1) is null
         or j.remote = 1 or j.country = any (p_countries))
    and (not p_remote or j.remote = 1)
  order by j.embedding <=> p_embedding::vector asc
  limit p_limit;
$$;
