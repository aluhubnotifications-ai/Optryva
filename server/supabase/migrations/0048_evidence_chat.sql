-- Evidence chat: employers interrogate an AI assistant (grounded in the
-- candidate's actual evidence) about whether claims are true and where the
-- proof is. Messages persist per (employer, student) conversation.
create table if not exists public.evidence_chat_messages (
  id                   text primary key default gen_random_uuid()::text,
  student_id           text not null references public.profiles(id) on delete cascade,
  user_id              text not null references public.profiles(id) on delete cascade,
  role                 text not null check (role in ('employer','ai')),
  content              text not null,
  created_at           timestamptz not null default now()
);
create index if not exists evidence_chat_conversation_idx on public.evidence_chat_messages(user_id, student_id, created_at);