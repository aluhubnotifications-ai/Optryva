-- Semantic matching — Layer 2 of the match engine: Voyage embeddings + pgvector.
-- Enable the extension, add 1024-dim embedding columns (Voyage voyage-3) to
-- profiles and job_listings, create cosine-distance indexes, and expose an RPC
-- the server can call over PostgREST (sb.rpc('semantic_job_matches', ...)) — the
-- dev box is IPv4-only so we talk REST, not raw SQL.
-- Run in the Supabase SQL Editor.

create extension if not exists vector;

alter table profiles     add column if not exists embedding vector(1024);
alter table job_listings add column if not exists embedding vector(1024);

-- ivfflat cosine indexes. lists is tuned small for a modest catalog; raise it as
-- the number of rows grows (rule of thumb: rows/1000). Run ANALYZE after backfill.
create index if not exists idx_profiles_embedding
  on profiles using ivfflat (embedding vector_cosine_ops) with (lists = 10);
create index if not exists idx_jobs_embedding
  on job_listings using ivfflat (embedding vector_cosine_ops) with (lists = 10);

-- Top-N active jobs ranked by cosine similarity to a student's embedding.
-- similarity = 1 - cosine_distance (higher = closer). Used as a semantic
-- prefilter/booster before the deterministic + Claude scoring layers.
create or replace function semantic_job_matches(p_student_id text, p_limit int default 50)
returns table (job_id text, similarity float)
language sql stable as $$
  select j.id, 1 - (j.embedding <=> p.embedding) as similarity
  from job_listings j
  cross join (select embedding from profiles where id = p_student_id) p
  where j.status = 'active'
    and j.embedding is not null
    and p.embedding is not null
  order by j.embedding <=> p.embedding
  limit p_limit;
$$;

