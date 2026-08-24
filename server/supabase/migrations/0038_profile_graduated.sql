-- Mark a student as already graduated so they stay eligible for internships and
-- other early-career opportunities (their "current year" is Graduate rather than
-- a study year 1..4). `graduated` is exposed on the profile and snapshotted onto
-- each application so employers can see it.
alter table if exists public.profiles
  add column if not exists graduated boolean not null default false;

alter table if exists public.applications
  add column if not exists graduated boolean not null default false;
