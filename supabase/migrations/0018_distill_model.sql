-- Score-distillation model store (roadmap Phase 3).

create table if not exists distill_model (
  id            text primary key default 'singleton',
  feature_names jsonb not null,
  weights       jsonb not null,
  n             integer not null default 0,
  mae           real,
  r2            real,
  agree_pm10    real,
  active        integer not null default 0,
  trained_at    text
);