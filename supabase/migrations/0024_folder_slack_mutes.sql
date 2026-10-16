-- 0024: per-folder Slack notification mutes.
--
-- NOT APPLIED AUTOMATICALLY — review and apply during a maintenance window.
-- Do NOT apply against production without approval.
--
-- One row = "Slack upload notifications are muted for this folder".
-- Unmuting deletes the row. Effective mute cascades to descendants at read
-- time (Workspace: folders.parent chain; Drive: same-account google_parent_id
-- chain), so removing a parent row, moving a folder, or creating new
-- subfolders can never leave orphaned or stale mute state behind.
-- Only the Slack fan-out is suppressed; in-app notifications and audit
-- logging are unaffected.

create table if not exists folder_slack_mutes (
  id uuid primary key default gen_random_uuid(),
  workspace_folder_id uuid references public.folders(id) on delete cascade,
  drive_account_id uuid,
  google_folder_id text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint folder_slack_mutes_target_check check (
    (workspace_folder_id is not null and drive_account_id is null and google_folder_id is null)
    or
    (workspace_folder_id is null and drive_account_id is not null and google_folder_id is not null)
  )
);

create unique index if not exists folder_slack_mutes_ws_uidx
  on folder_slack_mutes (workspace_folder_id)
  where workspace_folder_id is not null;

create unique index if not exists folder_slack_mutes_drive_uidx
  on folder_slack_mutes (drive_account_id, google_folder_id)
  where drive_account_id is not null;

create index if not exists folder_slack_mutes_drive_idx
  on folder_slack_mutes (drive_account_id);

alter table public.folder_slack_mutes enable row level security;
revoke all on public.folder_slack_mutes from anon, authenticated;
