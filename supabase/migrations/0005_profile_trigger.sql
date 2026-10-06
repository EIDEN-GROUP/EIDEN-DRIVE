-- 0005: auto-create a `profiles` row for every new auth user (invite, magic link, Google).
-- The row is ALWAYS role 'member': sign-up metadata is user-controlled, so it is never trusted for role.
-- The invite API (POST /api/users/invite) raises role/department afterwards with the service role.
-- Safe to re-run. Also back-fills existing users that have no profile yet.

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  base text := lower(regexp_replace(split_part(coalesce(new.email, 'user'), '@', 1), '[^a-zA-Z0-9._-]', '', 'g'));
  uname text;
begin
  if base = '' then base := 'user'; end if;
  uname := base;
  if exists (select 1 from public.profiles where username = uname) then
    uname := base || '-' || substr(replace(new.id::text, '-', ''), 1, 4);   -- keep usernames unique
  end if;
  insert into public.profiles (id, username, role) values (new.id, uname, 'member')
  on conflict (id) do nothing;   -- never overwrite an existing profile (e.g. one created by hand)
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- back-fill (existing sign-ups without a profile)
insert into public.profiles (id, username, role)
select u.id,
       case when exists (select 1 from public.profiles p where p.username = x.base)
            then x.base || '-' || substr(replace(u.id::text, '-', ''), 1, 4) else x.base end,
       'member'
from auth.users u
cross join lateral (select coalesce(nullif(lower(regexp_replace(split_part(coalesce(u.email,'user'), '@', 1), '[^a-zA-Z0-9._-]', '', 'g')), ''), 'user') as base) x
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict do nothing;
