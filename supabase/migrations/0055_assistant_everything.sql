-- Optryva Internship AI Assistant: the "Everything" package.
-- Core persistence for sessions + messages (with embedded actions for audit),
-- plus the action_types enum used by the immediate-injection engine.
--
-- Migration 0054 was already taken by conversations_for_user (the Messages tab
-- optimisation RPC), so this ships as 0055.

create table if not exists public.assistant_sessions (
  id           text primary key default gen_random_uuid()::text,
  user_id      text not null references public.profiles(id) on delete cascade,
  mode         text not null check (mode in ('student', 'employer', 'university')),
  context      jsonb not null default '{}'::jsonb,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.assistant_messages (
  id           text primary key default gen_random_uuid()::text,
  session_id   text not null references public.assistant_sessions(id) on delete cascade,
  role         text not null check (role in ('user', 'assistant', 'system')),
  content      text not null,
  actions      jsonb not null default '[]'::jsonb,
  tool_calls   jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists idx_asst_sessions_user on public.assistant_sessions(user_id);
create index if not exists idx_asst_msgs_session on public.assistant_messages(session_id);

-- Convenience RPC: fetch the most recent N messages for a session (newest-last
-- is what the chat UI threads expect, but we store ascending for readability).
create or replace function public.assistant_thread(sid text, lim integer default 50)
returns table (role text, content text, actions jsonb, created_at timestamptz)
language sql stable as $$
  select role, content, actions, created_at
  from public.assistant_messages
  where session_id = sid
  order by created_at asc
  limit lim
$$;
