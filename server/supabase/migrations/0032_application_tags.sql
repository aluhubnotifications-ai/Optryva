alter table applications add column if not exists tags text[] not null default '{}';
