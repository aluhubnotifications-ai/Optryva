-- Learning-to-rank model store (roadmap Phase 2).
--
-- A single row holding the trained ranker: which features it uses (the pre-LLM
-- subset), its weights + standardization, and an `active` flag. `npm run
-- train-ranker` fits it from match_features; the live funnel loads it to order
-- candidates before the LLM — but ONLY when `active = 1`, which the trainer sets
-- only once there are enough positive labels (so a noise model never ships).
-- Run in the Supabase SQL Editor.

create table if not exists ranker_model (
  id            text primary key default 'singleton',
  feature_names jsonb not null,                 -- ordered pre-LLM feature names
  weights       jsonb not null,                 -- { bias, w:number[], mean:number[], std:number[] }
  n             integer not null default 0,      -- training rows
  n_pos         integer not null default 0,      -- positive (engaged) rows
  auc           real,                            -- train-set AUC (overfit-prone on small n)
  active        integer not null default 0,      -- 1 => served in the funnel
  trained_at    text
);
