-- Structured résumé understanding — Layer 1 of the match engine.
-- Claude parses cv_text ONCE into this JSON when the CV is first scored or
-- whenever it changes, so per-job scoring cites stored evidence (skills with
-- proficiency, years, seniority, projects) instead of re-reading the raw résumé
-- for every job. resume_parsed_at lets the server detect a stale parse.
-- Run in the Supabase SQL Editor.

alter table profiles add column if not exists resume_profile  jsonb;
alter table profiles add column if not exists resume_parsed_at text;
