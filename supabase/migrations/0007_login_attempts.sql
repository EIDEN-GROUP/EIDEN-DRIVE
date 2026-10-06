-- 0007: failed sign-in attempts (feeds Security Center; insert-only, service role reads).
create table if not exists public.login_attempts (
  id bigint generated always as identity primary key,
  email text not null,
  ip text not null default '',
  reason text not null default '',
  created_at timestamptz not null default now()
);
alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from anon;
-- no policies: service role only (anon inserts go through the API, which throttles by IP).
