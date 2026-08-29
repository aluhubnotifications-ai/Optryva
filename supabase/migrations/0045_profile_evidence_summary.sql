-- Candidate-level AI summary of all evidence, shown to employers instead of the
-- raw gallery. Aggregated from each evidence item's ai_summary + skills.
alter table profiles add column if not exists evidence_summary text;
