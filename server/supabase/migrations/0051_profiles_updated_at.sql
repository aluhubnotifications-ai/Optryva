-- profiles.updated_at is written by the app on every update (onboarding progress
-- autosave, resume step, profile edits, etc.) but was never defined in init.sql.
-- Add it so the code and schema agree. Safe to re-run.
-- (PostgREST also needs a schema-cache reload after this DDL.)
--
-- Apply: npx supabase db query --linked --project-ref wzwjvlnqjebbmtlmkqzd \
--        --file server/supabase/migrations/0050_profiles_updated_at.sql

alter table profiles add column if not exists updated_at text;
