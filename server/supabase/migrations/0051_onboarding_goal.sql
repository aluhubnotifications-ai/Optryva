-- Stores the user's first onboarding goal (e.g. find opportunities, hire talent,
-- manage university careers) captured by the 3-question quick intake that runs
-- right after sign-in. Drives the "first goal" required onboarding step.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_goal text;
