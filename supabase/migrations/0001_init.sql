-- EIDEN-DRIVE P0 schema. RLS: members read scoped rows; writes via service role + API checks.
create table profiles (
  id uuid primary key references auth.users(id),
  username text unique not null, role text not null check (role in ('admin','manager','member')),
  department_tag text, device_ids text[] default '{}', created_at timestamptz default now()
);
create table folders (id uuid primary key default gen_random_uuid(), drive_id text, parent uuid references folders(id), name text not null, dept text, classification text default 'Internal');
create table file_index (
  id uuid primary key default gen_random_uuid(), name text not null, mime text, size bigint,
  hash text, google_file_id text, local_path text, backends text[] default '{google}',
  owner uuid references profiles(id), folder uuid references folders(id), updated_at timestamptz default now()
);
create table versions (id uuid primary key default gen_random_uuid(), file_id uuid references file_index(id) on delete cascade, v int not null, hash text, actor uuid references profiles(id), ts timestamptz default now());
create table audit_logs (
  id bigint generated always as identity primary key, ts timestamptz default now(),
  actor uuid references profiles(id), actor_name text, action text not null,
  file_id uuid references file_index(id), detail jsonb, ip text, user_agent text, device_id text
);
alter table audit_logs enable row level security;
create policy "read own + team audit" on audit_logs for select to authenticated using (true);
-- append-only: no update/delete policies for members
create table recovery_bin (file_id uuid primary key references file_index(id), deleted_by uuid references profiles(id), deleted_at timestamptz default now(), purge_at timestamptz default now() + interval '90 days');
create table approvals (id uuid primary key default gen_random_uuid(), action text, file_id uuid references file_index(id), requester uuid references profiles(id), approver uuid references profiles(id), status text default 'pending', created_at timestamptz default now());
create table vault_items (id uuid primary key default gen_random_uuid(), owner uuid references profiles(id), enc_blob text not null, created_by uuid references profiles(id), created_at timestamptz default now());
create table vault_auth (user_id uuid primary key references profiles(id), authed_at timestamptz, method text);
create table jobs (id uuid primary key default gen_random_uuid(), kind text, status text default 'pending', payload jsonb, created_at timestamptz default now());
create table notifications (id uuid primary key default gen_random_uuid(), user_id uuid references profiles(id), kind text, title text, body text, read boolean default false, created_at timestamptz default now());
