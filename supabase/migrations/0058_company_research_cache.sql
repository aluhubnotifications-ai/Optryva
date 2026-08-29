-- Cache company research results so the AI doesn't re-research the same
-- company/role on every panel open. Stale after 7 days (research TTL).
create table if not exists public.company_research_cache (
  company_role_hash  text         not null primary key,  -- md5(company || '|' || role)
  company            text         not null,
  role               text,
  text               text         not null,              -- streamed markdown content
  json               jsonb,                               -- parsed company info (overview/culture/etc.)
  provider           text         not null,              -- which AI provider produced this ('groq'|'claude'|'mistral')
  generated_at       timestamptz  not null default now(),
  expires_at         timestamptz  not null
);

create index if not exists idx_company_research_company on public.company_research_cache(company);
create index if not exists idx_company_research_expires on public.company_research_cache(expires_at);
