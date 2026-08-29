-- Onboarding tables per spec
-- 1. onboarding_progress - tracks step-by-step completion per account
-- 2. preference_profiles - detailed preferences per résumé (extends resume_profiles)
-- 3. consents - privacy, AI, notifications consents per account

create table if not exists onboarding_progress (
  account_id text primary key references app_users(id) on delete cascade,
  role text not null,                    -- 'student' | 'company' | 'school'
  current_step integer not null default 1,
  completed_steps integer not null default 0,
  skipped_steps text not null default '[]',  -- JSON array of step keys
  completed_at text,
  updated_at text not null
);

create table if not exists preference_profiles (
  id text primary key,
  student_id text not null references profiles(id) on delete cascade,
  resume_profile_id text references resume_profiles(id) on delete cascade,
  -- Role preferences
  target_roles text not null default '[]',           -- JSON array
  industries text not null default '[]',              -- JSON array
  locations text not null default '[]',               -- JSON array
  work_modes text not null default '[]',              -- JSON array (remote/hybrid/onsite)
  opportunity_types text not null default '[]',       -- JSON array (Internship/Fellowship/Full-time/Part-time)
  -- Availability
  availability_start text,                            -- ISO date
  availability_end text,                              -- ISO date
  availability_hours text,                            -- e.g. "20h/week"
  academic_schedule text,                             -- free text
  -- Compensation
  compensation_paid_only integer not null default 1,
  compensation_stipend_ok integer not null default 0,
  compensation_unpaid_ok integer not null default 0,
  compensation_min_amount text,                       -- e.g. "500 USD/month"
  -- Work authorization
  work_authorization text not null default '[]',      -- JSON array of country codes/arrangements
  -- Exclusions
  excluded_roles text not null default '[]',          -- JSON array
  excluded_countries text not null default '[]',      -- JSON array
  excluded_industries text not null default '[]',     -- JSON array
  excluded_schedules text not null default '[]',      -- JSON array
  created_at text not null,
  updated_at text not null
);

create index if not exists idx_preference_profiles_student on preference_profiles(student_id);
create index if not exists idx_preference_profiles_resume on preference_profiles(resume_profile_id);

create table if not exists consents (
  id text primary key,
  account_id text not null references app_users(id) on delete cascade,
  consent_type text not null,               -- 'profile_visibility' | 'ai_recommendations' | 'evidence_reuse' | 'university_access' | 'notifications'
  version text not null default '1',
  granted integer not null default 0,
  granted_at text,
  withdrawn_at text,
  unique (account_id, consent_type, version)
);

create index if not exists idx_consents_account on consents(account_id);

-- Extend resume_profiles with additional spec fields
alter table resume_profiles add column if not exists selected_evidence_ids text not null default '[]';
alter table resume_profiles add column if not exists preference_profile_id text references preference_profiles(id) on delete set null;
alter table resume_profiles add column if not exists visibility text not null default 'private';  -- 'private' | 'discoverable' | 'public'
alter table resume_profiles add column if not exists last_updated text;