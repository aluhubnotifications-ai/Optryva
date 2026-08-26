-- Speed up GET /messages/conversations on the Messages tab.
--
-- Previously the handler fetched EVERY message row across all of a user's
-- conversation threads (full history, ascending) and summarized in memory just
-- to learn the last message body + unread count per thread. For users with many
-- conversations that scan is O(total messages) and dominates load time.
--
-- This RPC computes the per-thread summary (last body, last created_at, unread
-- count) in a single indexed Postgres aggregate pass, so the handler only walks
-- the thread list instead of the full message history.
-- Run in the Supabase SQL Editor.

create or replace function conversations_for_user(me_id text, convo_thread_ids text[])
returns table (
  thread_id text,
  last_body text,
  last_attachment boolean,
  last_at text,
  unread integer
) language sql stable as $$
  select
    m.thread_id,
    max(m.body) filter (where m.body is not null) as last_body,
    bool_or(m.attachment is not null) as last_attachment,
    max(m.created_at) as last_at,
    count(*) filter (where m.read = 0 and m.sender_id <> me_id) as unread
  from messages m
  where m.thread_id = any(convo_thread_ids)
    and m.deleted = 0
  group by m.thread_id
$$;

create index if not exists idx_messages_thread_created
  on messages (thread_id, created_at);
