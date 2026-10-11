-- 0018: "Created by" + "Created" for files and folders (details panel).
-- Additive and re-runnable. The app tolerates these columns being absent, so
-- it can be applied before or after the deploy.
-- Columns are added WITHOUT a default first so existing rows stay NULL and can
-- be backfilled from history; the default is set afterwards for new rows.

alter table public.file_index add column if not exists created_at timestamptz;
alter table public.folders add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.folders add column if not exists created_at timestamptz;

-- Files: the first version is the upload moment; else the last change.
-- (The creator of a file is its owner — no extra column needed.)
update public.file_index f
set created_at = coalesce((select min(v.ts) from public.versions v where v.file_id = f.id), f.updated_at, now())
where f.created_at is null;

-- Folders: the earliest "add" audit event naming the folder (POST /api/folders
-- logs detail.folder = name). Best effort — unmatched folders keep a null creator.
update public.folders fo
set created_by = a.actor, created_at = a.ts
from (
  select distinct on (detail->>'folder') detail->>'folder' as name, actor, ts
  from public.audit_logs
  where action = 'add' and detail ? 'folder'
  order by detail->>'folder', ts asc
) a
where fo.created_at is null and a.name = fo.name;

alter table public.file_index alter column created_at set default now();
alter table public.folders alter column created_at set default now();
