-- Store the actual résumé file (as a data URL) on the profile, not just its
-- filename — so a student's CV can be viewed from their profile and reused
-- (pre-filled) when they apply, and the company can open it.
-- Run in the Supabase SQL Editor.

alter table profiles add column if not exists cv_url text;
