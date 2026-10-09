-- Clear Google-only rows from file_index (Supabase/local files are untouched).
-- Run in Supabase Dashboard > SQL. Transactional: any error rolls everything back.
--
-- What goes:
--   * pure Google rows (google pin, NO Storage copy) → DELETED
--   * hybrid rows (Storage bytes + google pin) → KEPT, google pin removed
--   * audit history is detached (file_id → NULL), same as the app's purge route
--   * recovery_bin / approvals links on those rows are deleted (plain FKs)
--   * versions, share_links and file_tags cascade automatically
-- Drive bytes are NEVER touched. Run "Sync from Google" afterwards to rebuild
-- the index inside the drives' current scope.
--
-- SCOPE GUARD: this script refuses to run unless at least one drive is scoped
-- to a folder. On an unscoped (whole-drive) setup there is no "previous
-- location" — account-less rows may be the only index of live files.
do $$
begin
  if not exists (
    select 1 from drive_accounts where status = 'active' and root_id is not null
  ) then
    raise exception 'Refused: no scoped drive. Scope a drive to a folder first (Storage page → drive → root), otherwise these rows may still be live.';
  end if;
end $$;

begin;

-- 0) Verify first: these two counts are what steps 3–4 will change.
select count(*) as pure_google_rows_to_delete from file_index
 where google_file_id is not null and storage_path is null;
select count(*) as hybrid_rows_to_unpin from file_index
 where google_file_id is not null and storage_path is not null;

-- 1) audit_logs has NO cascade → detach history or the delete is refused.
update audit_logs set file_id = null
 where file_id in (
   select id from file_index
   where google_file_id is not null and storage_path is null
 );

-- 2) recovery_bin + approvals are plain FKs → drop those links.
delete from recovery_bin
 where file_id in (
   select id from file_index
   where google_file_id is not null and storage_path is null
 );
delete from approvals
 where file_id in (
   select id from file_index
   where google_file_id is not null and storage_path is null
 );

-- 3) The pure Google rows themselves.
delete from file_index
 where google_file_id is not null and storage_path is null;

-- 4) Hybrids keep their Storage bytes — only the Google pin is removed.
update file_index
   set google_file_id = null,
       google_parent_id = null,
       drive_account_id = null,
       backends = case
         when backends is null then array['local']
         else array_remove(backends, 'google')
       end
 where google_file_id is not null and storage_path is not null;
update file_index
   set backends = array['local']
 where storage_path is not null and (backends is null or backends = '{}');

commit;

-- 5) Verify: both must be 0.
select count(*) as remaining_google_rows from file_index
 where google_file_id is not null;
