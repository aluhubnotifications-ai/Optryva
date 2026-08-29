-- Clear stale summaries so they regenerate fresh
-- (safe to re-run: just deletes cached rows)
delete from candidate_summaries;
update profiles set evidence_summary = null where evidence_summary is not null;
