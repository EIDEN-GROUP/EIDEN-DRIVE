-- 0009: multiple Google Drive accounts with quota-aware routing.
-- One row per connected Gmail. Tokens live here (service-role only, no client
-- policies) instead of a single GOOGLE_REFRESH_TOKEN env var.
create table if not exists drive_accounts (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  email text,
  refresh_token text not null,
  root_id text,
  status text not null default 'active' check (status in ('active', 'down', 'disabled')),
  priority int not null default 0,
  last_checked_at timestamptz,
  created_at timestamptz default now()
);
alter table drive_accounts enable row level security;
-- No client policies: all access through the service-role API after session checks.

alter table file_index add column if not exists drive_account_id uuid references drive_accounts(id) on delete set null;
