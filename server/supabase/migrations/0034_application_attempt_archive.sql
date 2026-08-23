-- Archive of every submitted assessment attempt so the first attempt stays
-- reviewable even after the employer grants a retake. Each entry holds the
-- answers, AI score/feedback and metadata for that specific submission.
alter table applications add column if not exists assignment_attempts text;
