-- 0019: active-drive enforcement support.
--
-- NOT APPLIED AUTOMATICALLY — a storage admin reviews and applies this during
-- a brief maintenance window (brief downtime allowed). Do NOT apply against
-- production without explicit approval.
--
-- 1) Fast lookups for the fail-closed gates (requireActiveAccount /
--    driveGoneReason run on every drive-touching request).
create index if not exists drive_accounts_status_idx
  on drive_accounts (status);

-- 2) Persistent home for the active_drive_check flag (default ON when the
--    row is absent). Admin toggle lives in Storage → /api/drive/settings.
create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Service role owns it; no RLS needed (server-only table, like drive_accounts
-- refresh tokens — never exposed to clients).
