-- 0013: user-created tags that can be attached to files and folders (filter + organise).
-- Separate from the manager-set `folders.dept` department tag. Server-only access (service role) after
-- the API's own session checks — same pattern as drive_accounts/plans: RLS on, no client policies.
-- Prerequisite check: fail early with a readable message instead of "relation does not exist".
do $$
begin
  if to_regclass('public.file_index') is null or to_regclass('public.folders') is null or to_regclass('public.profiles') is null then
    raise exception 'Tags need the base schema first: public.profiles / public.folders / public.file_index are missing. Either this is the wrong Supabase project, or migrations 0001_init … 0012 have not been applied yet (run them in order).';
  end if;
end $$;

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 32),
  color text not null default '#5b3fd0' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists tags_name_uidx on public.tags (lower(name));

create table if not exists public.file_tags (
  file_id uuid not null references public.file_index(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (file_id, tag_id)
);
create table if not exists public.folder_tags (
  folder_id uuid not null references public.folders(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (folder_id, tag_id)
);
create index if not exists file_tags_tag_idx on public.file_tags (tag_id);
create index if not exists folder_tags_tag_idx on public.folder_tags (tag_id);

alter table public.tags enable row level security;
alter table public.file_tags enable row level security;
alter table public.folder_tags enable row level security;
revoke all on public.tags, public.file_tags, public.folder_tags from anon, authenticated;
