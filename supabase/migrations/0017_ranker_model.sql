-- Learning-to-rank model store (roadmap Phase 2).

create table if not exists ranker_model (
  id            text primary key default 'singleton',
  feature_names jsonb not null,
  weights       jsonb not null,
  n             integer not null default 0,
  n_pos         integer not null default 0,
  auc           real,
  active        integer not null default 0,
  trained_at    text
);