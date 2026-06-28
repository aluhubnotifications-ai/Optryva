-- Score-distillation model store (roadmap Phase 3).
--
-- A model that learns to MIMIC Claude's honest 0-99 match score from cheap pre-LLM
-- features. The teacher labels already exist — every score in ai_match_cache is a
-- Claude judgment — so this trains today (no engagement needed). Use: a Claude-free
-- estimate when the LLM is unavailable, and a cost lever (skip the LLM on confident
-- cases later). This is an asset we OWN: it encodes Claude's judgment distilled onto
-- our marketplace. `npm run train-distill` fits it; the app loads it when active.
-- Run in the Supabase SQL Editor.

create table if not exists distill_model (
  id            text primary key default 'singleton',
  feature_names jsonb not null,                 -- ordered pre-LLM feature names
  weights       jsonb not null,                 -- { bias, w[], mean[], std[], ymean, ystd }
  n             integer not null default 0,      -- training rows (teacher scores)
  mae           real,                            -- mean abs error vs Claude (0-99 scale)
  r2            real,                            -- coefficient of determination
  agree_pm10    real,                            -- % of predictions within ±10 of Claude (fidelity)
  active        integer not null default 0,      -- 1 => usable as a fallback
  trained_at    text
);
