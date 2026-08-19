-- Learning-to-rank feature store (roadmap Phase 2).
--
-- Materialized (student, job) feature vectors + a graded relevance LABEL, built by
-- `npm run build-features` from data we already have (the LLM score, embedding
-- cosine, skill overlap, …) joined with real engagement (opens / applies / hires).
-- This is the training set for the ranker that will sit between retrieval and the
-- LLM. No model lives here — just the rows a model trains on.
-- Run in the Supabase SQL Editor.

create table if not exists match_features (
  student_id text not null references profiles(id) on delete cascade,
  job_id     text not null references job_listings(id) on delete cascade,
  features   jsonb not null,
  label      integer not null default 0,
  pred_score integer,
  built_at   text not null,
  primary key (student_id, job_id)
);

create index if not exists match_features_label_idx on match_features (label);