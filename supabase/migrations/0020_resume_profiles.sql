-- Multiple résumé profiles per student. Each profile is a career direction
-- backed by the student's master profile and independently configurable preferences.
create table if not exists resume_profiles (
  id text primary key,
  student_id text not null references profiles(id) on delete cascade,
  name text not null,
  target_roles text not null default '[]',
  preferred_industries text not null default '[]',
  pref_countries text not null default '[]',
  pref_listing_types text not null default '[]',
  skills text not null default '[]',
  work_type text not null default 'any',
  cv_filename text,
  cv_url text,
  active integer not null default 1,
  created_at text not null,
  updated_at text not null
);

create index if not exists idx_resume_profiles_student on resume_profiles(student_id);