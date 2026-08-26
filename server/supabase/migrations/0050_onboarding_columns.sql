-- Reconcile remaining schema drift found during onboarding testing.
-- resume_profiles is missing several columns defined in init.sql, and the
-- preference_profiles table is entirely absent in the live DB.
-- Safe to re-run (IF NOT EXISTS / CREATE IF NOT EXISTS).
--
-- Apply: npx supabase db query --linked --project-ref wzwjvlnqjebbmtlmkqzd \
--        --file server/supabase/migrations/0049_onboarding_columns.sql

-- resume_profiles: columns present in init.sql but missing live
alter table resume_profiles add column if not exists cv_text                text;
alter table resume_profiles add column if not exists selected_evidence_ids text not null default '[]';
alter table resume_profiles add column if not exists preference_profile_id text;
alter table resume_profiles add column if not exists visibility            text not null default 'private';
alter table resume_profiles add column if not exists last_updated          text;

-- preference_profiles: table entirely missing in the live DB
create table if not exists preference_profiles (
  id                     text primary key,
  student_id             text not null references profiles(id) on delete cascade,
  resume_profile_id      text references resume_profiles(id) on delete cascade,
  target_roles           text not null default '[]',
  industries             text not null default '[]',
  locations              text not null default '[]',
  work_modes             text not null default '[]',
  opportunity_types      text not null default '[]',
  availability_start     text,
  availability_end       text,
  availability_hours     text,
  academic_schedule      text,
  compensation_paid_only integer not null default 1,
  compensation_stipend_ok integer not null default 0,
  compensation_unpaid_ok  integer not null default 0,
  compensation_min_amount text,
  work_authorization     text not null default '[]',
  excluded_roles         text not null default '[]',
  excluded_countries     text not null default '[]',
  excluded_industries    text not null default '[]',
  excluded_schedules     text not null default '[]',
  created_at             text not null,
  updated_at             text not null
);
create index if not exists idx_preference_profiles_student on preference_profiles(student_id);
create index if not exists idx_preference_profiles_resume  on preference_profiles(resume_profile_id);
