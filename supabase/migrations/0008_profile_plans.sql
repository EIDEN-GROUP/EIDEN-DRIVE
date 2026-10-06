-- 0008: profile enrichment (avatar + phone) and personal plans for the calendar.
alter table profiles add column if not exists phone text;
alter table profiles add column if not exists avatar_path text;

create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  owner uuid references profiles(id) on delete cascade,
  title text not null,
  detail text,
  plan_date date not null,
  plan_time text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  folder uuid references folders(id) on delete set null,
  done boolean not null default false,
  created_at timestamptz default now()
);
alter table plans enable row level security;
-- No client policies: all reads/writes go through the service-role API after session checks.
