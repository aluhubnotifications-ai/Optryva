-- The assessment/integrity timeline (applied, test_return, test_submitted,
-- test_unlocked events) is read and written by the applications routes. It was
-- created in the live database but never tracked by a migration, so this makes
-- the repository self-consistent for fresh deploys. Stored as text (a JSON
-- string) which matches how the server serialises it.
alter table applications add column if not exists timeline text;
