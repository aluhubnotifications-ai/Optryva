-- School student-domain restriction + school privacy.
--
-- A school lists the email domains of its students (e.g. ["alueducation.com",
-- "alustudent.com"]). Two new gates use it:
--   • is_private   — when set, only viewers whose account email domain matches one
--                    of the school's student_domains can see the school profile or
--                    any of its jobs.
--   • students_only (on a job) — restrict that single listing to the posting
--                    school's student domains, even if the school is public.

alter table profiles      add column if not exists student_domains text;                       -- JSON array of strings
alter table profiles      add column if not exists is_private      integer not null default 0;  -- school privacy flag
alter table job_listings  add column if not exists students_only   integer not null default 0;  -- restrict to poster's student domains
