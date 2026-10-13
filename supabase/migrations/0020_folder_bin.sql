-- 0020: folder-aware Recovery Bin.
--
-- NOT APPLIED AUTOMATICALLY — a storage admin reviews and applies this during
-- a maintenance window. Do NOT apply against production without approval.
--
-- Local Workspace folder deletion used to destroy folder rows (files were
-- re-homed + binned, folders deleted), making folder restore impossible.
-- folder_bin preserves a trashed folder's identity so the whole subtree
-- restores as a unit. Follows the recovery_bin convention: plain references
-- (the API nulls deleted_by on user removal and deletes rows on restore/
-- purge — no silent cascades).
create table if not exists folder_bin (
  folder_id uuid primary key references folders(id),
  deleted_by uuid references profiles(id),
  deleted_at timestamptz not null default now(),
  purge_at timestamptz not null default now() + interval '90 days'
);
