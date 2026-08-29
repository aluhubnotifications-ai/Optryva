-- Align the live Supabase schema with init.sql for the Google OAuth sign-in path.
-- Discovered via introspection: app_users is missing the 3 provider columns and
-- onboarding_progress does not exist at all. profiles is already complete.
-- Safe to re-run (IF NOT EXISTS / CREATE IF NOT EXISTS).
--
-- Apply: npx supabase db query --linked --project-ref wzwjvlnqjebbmtlmkqzd \
--        --file server/supabase/migrations/0048_oauth_provider_columns.sql

-- app_users: provider-linking columns
alter table app_users  add column if not exists auth_provider      text;
alter table app_users  add column if not exists provider_subject   text;
alter table app_users  add column if not exists provider_metadata text;

-- app_users: Google-only accounts have no password (init.sql has it nullable;
-- the live table was created NOT NULL and must be relaxed to match).
alter table app_users alter column password_hash drop not null;

-- onboarding_progress: table is entirely missing in the live DB
create table if not exists onboarding_progress (
  account_id       text primary key references app_users(id) on delete cascade,
  role             text not null,
  current_step     integer not null default 1,
  completed_steps  integer not null default 0,
  skipped_steps    text not null default '[]',
  completed_at     text,
  updated_at       text not null
);
