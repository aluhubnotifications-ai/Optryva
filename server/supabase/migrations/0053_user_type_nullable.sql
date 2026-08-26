-- Allow new sign-ups (Google in particular) to start with no role so the
-- onboarding flow can explicitly ask "are you a company or a student?" instead
-- of silently defaulting everyone to 'student'. Existing rows keep their value.
alter table profiles alter column user_type drop not null;
