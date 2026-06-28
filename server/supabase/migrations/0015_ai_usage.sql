-- AI usage metering: one row per Anthropic API call, attributed to the user, so
-- the app can show "usage of credits" with per-model input/output token totals.
-- Run in the Supabase SQL Editor. Degrades gracefully until applied (the server
-- guards on table existence; no writes/reads fail before this runs).

create table if not exists ai_usage (
  id text primary key,
  user_id text,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_creation_tokens integer not null default 0,
  created_at text not null
);

-- The usage page aggregates a single user's rows by model.
create index if not exists idx_ai_usage_user on ai_usage(user_id);
create index if not exists idx_ai_usage_user_model on ai_usage(user_id, model);
