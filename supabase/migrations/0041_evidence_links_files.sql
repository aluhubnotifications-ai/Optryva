-- Support multiple links (any URL: website, GitHub, Instagram, YouTube, article…)
-- and multiple file/picture attachments per evidence item.
alter table public.evidence_items
  add column if not exists links jsonb not null default '[]'::jsonb,
  add column if not exists files jsonb not null default '[]'::jsonb;

-- Backfill existing single-link / single-file rows into the new arrays.
update public.evidence_items
  set links = to_jsonb(array[url])
  where url is not null and (links is null or links = '[]'::jsonb);

update public.evidence_items
  set files = jsonb_build_array(jsonb_build_object('path', file_path, 'name', file_name))
  where file_path is not null and (files is null or files = '[]'::jsonb);
