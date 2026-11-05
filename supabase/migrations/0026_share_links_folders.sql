-- 0026: public share links for folders (Workspace) in addition to files.
--
-- NOT APPLIED AUTOMATICALLY - review and apply during a maintenance window.
-- Do NOT apply against production without approval.
--
-- Existing file_id-only links stay valid. A new folder link stores folder_id
-- (Workspace) or reuses file_id when the target is an indexed Google-folder
-- row.
alter table if exists share_links
  add column if not exists folder_id uuid references public.folders(id) on delete cascade,
  add column if not exists kind text not null default 'file';

alter table if exists share_links
  alter column file_id drop not null;

do $$
begin
  if to_regclass('public.share_links') is not null and
     not exists (select 1 from pg_constraint where conname = 'share_links_target_kind') then
    alter table public.share_links add constraint share_links_target_kind check (
      (kind = 'file' and file_id is not null and folder_id is null)
      or (kind = 'folder' and file_id is null and folder_id is not null)
      or (kind = 'folder' and file_id is not null and folder_id is null)
    );
  end if;
end
$$;

create index if not exists share_links_folder_idx on public.share_links (folder_id, created_at desc);
