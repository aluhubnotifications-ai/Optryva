-- Backfill the existing profile into an equal first résumé direction.
-- This is idempotent and does not touch match caches or matching timestamps.
insert into resume_profiles (
  id,
  student_id,
  name,
  target_roles,
  preferred_industries,
  pref_countries,
  pref_listing_types,
  skills,
  work_type,
  cv_filename,
  cv_url,
  cv_storage_path,
  active,
  created_at,
  updated_at
)
select
  'resume_' || gen_random_uuid()::text,
  p.id,
  'Resume 1',
  coalesce(p.desired_roles, '[]'),
  coalesce(p.preferred_industries, '[]'),
  coalesce(p.pref_countries, '[]'),
  coalesce(p.pref_listing_types, '[]'),
  coalesce(p.skills, '[]'),
  coalesce(p.work_type, 'any'),
  p.cv_filename,
  p.cv_url,
  p.cv_storage_path,
  1,
  p.created_at,
  p.created_at
from profiles p
where p.user_type = 'student'
  and not exists (
    select 1 from resume_profiles r where r.student_id = p.id
  );
