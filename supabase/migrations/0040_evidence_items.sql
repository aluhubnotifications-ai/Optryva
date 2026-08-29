-- Evidence items: the student-owned, verifiable proof behind résumé claims.
-- Pipeline: student uploads work -> AI extracts possible skills -> student
-- confirms contribution -> supervisor/university/employer verifies -> Optryva
-- labels the evidence self_reported | student_approved | verified.
create table if not exists public.evidence_items (
  id                   text primary key default gen_random_uuid()::text,
  student_id           text not null references public.profiles(id) on delete cascade,
  title                text not null,
  description          text not null default '',
  url                  text,
  file_path            text,
  file_name            text,
  extracted_skills     jsonb not null default '[]'::jsonb,
  confirmed_skills     jsonb not null default '[]'::jsonb,
  status               text not null default 'self_reported'
                         check (status in ('self_reported','student_approved','verified')),
  verified_by          text references public.profiles(id) on delete set null,
  verified_at          timestamptz,
  verification_requested boolean not null default false,
  created_at           timestamptz not null default now()
);
create index if not exists evidence_items_student_idx on public.evidence_items(student_id);
