
-- Track people who clicked through to apply on an EXTERNAL listing.
--
-- When a listing applies off-platform (apply_url is set), Optryva never receives
-- the application, so the "applicants" count is always 0 and misleading. Instead
-- we count the unique people who opened the external apply link. The (job_id,
-- user_id) primary key keeps it one row per person per job.
create table if not exists job_opens (
  job_id     text not null references job_listings(id) on delete cascade,
  user_id    text not null references profiles(id) on delete cascade,
  created_at text not null,
  primary key (job_id, user_id)
);

create index if not exists job_opens_job_idx on job_opens (job_id);
