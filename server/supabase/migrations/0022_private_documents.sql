-- Private résumé and application documents.
alter table profiles add column if not exists cv_storage_path text;
alter table resume_profiles add column if not exists cv_storage_path text;

create table if not exists document_access_audit (
  id text primary key,
  document_path text not null,
  viewer_id text not null,
  action text not null,
  created_at text not null
);

create index if not exists idx_document_audit_path on document_access_audit(document_path);
create index if not exists idx_document_audit_viewer on document_access_audit(viewer_id);

insert into storage.buckets (id, name, public)
values ('private-documents', 'private-documents', false)
on conflict (id) do update set public = false;
