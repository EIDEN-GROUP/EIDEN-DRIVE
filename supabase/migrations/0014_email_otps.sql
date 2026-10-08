-- 0014: our own email OTP codes (SMTP-sent), used for invite-onboarding step-up.
-- Supabase sessions can't be minted from custom codes, so these prove inbox
-- ownership only; the session still comes from a Supabase link/token exchange.
create table if not exists email_otps (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  purpose text not null,
  code_hash text not null,
  attempts int not null default 0,
  consumed boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);
alter table email_otps enable row level security;
-- No client policies (service-role API only) + explicit revoke, same rule as 0012.
revoke all on public.email_otps from anon, authenticated;
create index if not exists email_otps_email_idx on email_otps (email, purpose, created_at desc);
