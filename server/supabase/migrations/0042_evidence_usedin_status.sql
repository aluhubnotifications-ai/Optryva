-- Track which résumé profiles each evidence item powers, and normalise the
-- status vocabulary to the five values the product uses.
alter table public.evidence_items
  add column if not exists used_in jsonb not null default '[]'::jsonb;

-- Old generic "verified" rows become supervisor-verified (the common case).
update public.evidence_items set status = 'supervisor_verified' where status = 'verified';
