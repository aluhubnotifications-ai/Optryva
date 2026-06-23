-- Outcome-calibration store (the match engine's feedback loop).
-- A single row holds the live weight overrides and a rubric addendum that the
-- calibration job (scripts/calibrate.ts) derives by comparing predicted scores
-- against real application outcomes (shortlisted / hired / rejected). This is
-- how scores stay HONEST over time: if the engine is systematically optimistic,
-- calibration tightens it. Run in the Supabase SQL Editor.

create table if not exists ai_calibration (
  id               text primary key default 'singleton',
  weights          jsonb,            -- partial MatchWeights overrides, or null
  rubric_addendum  text,             -- extra calibration guidance for the LLM scorer
  sample_size      integer not null default 0,
  updated_at       text
);

insert into ai_calibration (id, sample_size) values ('singleton', 0)
  on conflict (id) do nothing;
