-- Track how many attempts a candidate has made on a job's assignment (including
-- proctor-cancelled attempts) so we can enforce an employer-set retry limit.
alter table applications add column if not exists attempts integer not null default 0;
