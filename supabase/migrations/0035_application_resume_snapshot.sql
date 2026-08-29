-- Capture the résumé that produced the match at apply time so reviewers can
-- compare "the résumé used for matching" against the candidate's CURRENT résumé
-- (e.g. gaps filled after applying). Stored as a lightweight, frozen snapshot.
alter table applications add column if not exists resume_id text;
alter table applications add column if not exists resume_snapshot text;
