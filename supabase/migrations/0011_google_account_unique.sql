-- 0011: one Google file belongs to exactly one account row.
-- Prevents account B's sync from adopting/hijacking account A's row when the
-- same Drive file is visible to both (shared files, shared drives).
create unique index if not exists file_index_google_account_uidx
  on file_index (google_file_id, drive_account_id)
  where google_file_id is not null and drive_account_id is not null;
