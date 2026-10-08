-- 0016: public share links. The token is unguessable (256-bit); only its
-- sha256 is stored, so a DB read alone never yields a working link.
create table if not exists share_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  file_id uuid not null references file_index(id) on delete cascade,
  created_by uuid references profiles(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);
alter table share_links enable row level security;
revoke all on public.share_links from anon, authenticated;
create index if not exists share_links_file_idx on share_links (file_id, created_at desc);
