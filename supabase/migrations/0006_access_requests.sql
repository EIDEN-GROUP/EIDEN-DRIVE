-- 0006: public access-request inbox (the "Ask a manager to invite you" form).
-- Anyone can ASK (anon insert, validated shape); only managers read/resolve.
create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  email text not null check (char_length(email) between 3 and 254),
  message text not null default '' check (char_length(message) <= 500),
  status text not null default 'pending' check (status in ('pending','invited','declined')),
  created_at timestamptz not null default now()
);
alter table public.access_requests enable row level security;
revoke all on public.access_requests from anon;
drop policy if exists access_requests_insert on public.access_requests;
create policy access_requests_insert on public.access_requests for insert to anon with check (true);
drop policy if exists access_requests_select on public.access_requests;
create policy access_requests_select on public.access_requests for select to authenticated using (public.is_manager());
drop policy if exists access_requests_update on public.access_requests;
create policy access_requests_update on public.access_requests for update to authenticated using (public.is_manager()) with check (public.is_manager());
