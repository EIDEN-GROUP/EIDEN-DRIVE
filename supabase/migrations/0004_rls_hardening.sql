-- 0004: Row-Level Security on EVERY table + vault TOTP. Apply in Supabase Dashboard > SQL editor.
-- Why: 0001 enabled RLS only on audit_logs. The anon key ships in the browser, so every other table
-- was readable/writable by anyone holding it (incl. profiles.role and vault_auth).
-- Model: signed-in users read company data; writes are limited to your own rows; managers/admins
-- moderate; the SERVER (service-role key, which bypasses RLS) writes audit, jobs, vault_auth,
-- notifications and profile changes after its own role checks. Safe to re-run.

-- ── helpers ────────────────────────────────────────────────────────────────
create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin','manager') from public.profiles where id = auth.uid()), false)
$$;
revoke all on function public.is_manager() from public;
grant execute on function public.is_manager() to authenticated;

-- ── vault second factor (service-role only: RLS on, no policies) ──────────
create table if not exists public.vault_totp (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  secret text not null,
  confirmed boolean not null default false,
  fail_count int not null default 0,
  locked_until timestamptz,
  created_at timestamptz default now()
);

-- ── nothing for the anonymous role ────────────────────────────────────────
revoke all on all tables in schema public from anon;

-- ── enable RLS everywhere ─────────────────────────────────────────────────
alter table public.profiles      enable row level security;
alter table public.folders       enable row level security;
alter table public.file_index    enable row level security;
alter table public.versions      enable row level security;
alter table public.audit_logs    enable row level security;
alter table public.recovery_bin  enable row level security;
alter table public.approvals     enable row level security;
alter table public.vault_items   enable row level security;
alter table public.vault_auth    enable row level security;
alter table public.vault_totp    enable row level security;
alter table public.jobs          enable row level security;
alter table public.notifications enable row level security;

-- ── policies (drop-then-create so the file is re-runnable) ────────────────
drop policy if exists "read own + team audit" on public.audit_logs;
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated
  using (public.is_manager() or actor = auth.uid());               -- inserts: service role only

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);  -- writes: service role only

drop policy if exists folders_select on public.folders;
drop policy if exists folders_insert on public.folders;
drop policy if exists folders_update on public.folders;
drop policy if exists folders_delete on public.folders;
create policy folders_select on public.folders for select to authenticated using (true);
create policy folders_insert on public.folders for insert to authenticated with check (true);
create policy folders_update on public.folders for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy folders_delete on public.folders for delete to authenticated using (public.is_manager());

drop policy if exists files_select on public.file_index;
drop policy if exists files_insert on public.file_index;
drop policy if exists files_update on public.file_index;
drop policy if exists files_delete on public.file_index;
create policy files_select on public.file_index for select to authenticated using (true);
create policy files_insert on public.file_index for insert to authenticated with check (owner = auth.uid());
create policy files_update on public.file_index for update to authenticated using (owner = auth.uid() or public.is_manager()) with check (owner = auth.uid() or public.is_manager());
create policy files_delete on public.file_index for delete to authenticated using (public.is_manager());

drop policy if exists versions_select on public.versions;
drop policy if exists versions_insert on public.versions;
create policy versions_select on public.versions for select to authenticated using (true);
create policy versions_insert on public.versions for insert to authenticated with check (actor = auth.uid());

drop policy if exists bin_select on public.recovery_bin;
drop policy if exists bin_insert on public.recovery_bin;
drop policy if exists bin_update on public.recovery_bin;
drop policy if exists bin_delete on public.recovery_bin;
create policy bin_select on public.recovery_bin for select to authenticated using (true);
create policy bin_insert on public.recovery_bin for insert to authenticated with check (deleted_by = auth.uid());
create policy bin_update on public.recovery_bin for update to authenticated using (deleted_by = auth.uid() or public.is_manager()) with check (deleted_by = auth.uid() or public.is_manager());
create policy bin_delete on public.recovery_bin for delete to authenticated using (public.is_manager());   -- restore = manager+

drop policy if exists approvals_select on public.approvals;
drop policy if exists approvals_insert on public.approvals;
drop policy if exists approvals_update on public.approvals;
create policy approvals_select on public.approvals for select to authenticated using (requester = auth.uid() or public.is_manager());
create policy approvals_insert on public.approvals for insert to authenticated with check (requester = auth.uid());
create policy approvals_update on public.approvals for update to authenticated using (public.is_manager()) with check (public.is_manager());

drop policy if exists vault_items_select on public.vault_items;
drop policy if exists vault_items_insert on public.vault_items;
drop policy if exists vault_items_update on public.vault_items;
drop policy if exists vault_items_delete on public.vault_items;
create policy vault_items_select on public.vault_items for select to authenticated using (owner = auth.uid() or public.is_manager());
create policy vault_items_insert on public.vault_items for insert to authenticated with check (public.is_manager());
create policy vault_items_update on public.vault_items for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy vault_items_delete on public.vault_items for delete to authenticated using (public.is_manager());

drop policy if exists vault_auth_select on public.vault_auth;
create policy vault_auth_select on public.vault_auth for select to authenticated using (user_id = auth.uid());   -- writes: service role only (after a valid TOTP)

drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs for select to authenticated using (public.is_manager());                -- writes: service role only

drop policy if exists notif_select on public.notifications;
drop policy if exists notif_update on public.notifications;
create policy notif_select on public.notifications for select to authenticated using (user_id = auth.uid() or (user_id is null and public.is_manager()));
create policy notif_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
