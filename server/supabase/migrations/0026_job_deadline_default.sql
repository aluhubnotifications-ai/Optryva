-- Ensure every listing has at least ~1 month of life and isn't left with a
-- missing/expired deadline. The app has no auto-expiry logic, but a blank or
-- past deadline looks "expired" to users, so backfill anything stale.
update job_listings
set deadline = (now() + interval '1 month')::text
where deadline is null
   or deadline = ''
   or deadline < (now())::text;

-- Future listings created without an explicit deadline get a 1-month default.
alter table job_listings alter column deadline set default (now() + interval '1 month')::text;
