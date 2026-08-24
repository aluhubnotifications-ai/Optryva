-- Comments/questions on evidence items, for reviewers to ask for clarification
create table if not exists public.evidence_comments (
  id                   text primary key default gen_random_uuid()::text,
  evidence_id          text not null references public.evidence_items(id) on delete cascade,
  user_id              text references public.profiles(id) on delete set null,
  content              text not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists evidence_comments_evidence_idx on public.evidence_comments(evidence_id);
create index if not exists evidence_comments_user_idx on public.evidence_comments(user_id);