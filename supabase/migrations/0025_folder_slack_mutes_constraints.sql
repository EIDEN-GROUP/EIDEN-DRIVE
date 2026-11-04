-- 0025: repair ON CONFLICT targets for folder_slack_mutes.
--
-- NOT APPLIED AUTOMATICALLY — review and apply during a maintenance window.
-- Do NOT apply against production without approval.
--
-- The first version of 0024 created PARTIAL unique indexes
-- (folder_slack_mutes_ws_uidx / folder_slack_mutes_drive_uidx). Plain
-- `ON CONFLICT (columns)` upserts cannot match a partial index, so muting a
-- folder failed with "there is no unique or exclusion constraint matching
-- the ON CONFLICT specification". Plain UNIQUE constraints accept the same
-- non-null uniqueness (NULLs are distinct), which is exactly the
-- one-target-kind rule this table needs.
--
-- If 0024 was never applied, apply the fixed 0024 then this file (the drops
-- below no-op and the constraint adds are skipped when already present).

drop index if exists public.folder_slack_mutes_ws_uidx;
drop index if exists public.folder_slack_mutes_drive_uidx;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'folder_slack_mutes_ws_uniq') then
    alter table public.folder_slack_mutes
      add constraint folder_slack_mutes_ws_uniq unique (workspace_folder_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'folder_slack_mutes_drive_uniq') then
    alter table public.folder_slack_mutes
      add constraint folder_slack_mutes_drive_uniq unique (drive_account_id, google_folder_id);
  end if;
end
$$;
