-- Optional pre-interview assignment and rubric for each listing/application.
alter table job_listings add column if not exists assignment text;
alter table applications add column if not exists assignment_answers text;
alter table applications add column if not exists assignment_status text;