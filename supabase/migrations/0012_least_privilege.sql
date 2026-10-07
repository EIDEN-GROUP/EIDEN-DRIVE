-- 0012: explicit least-privilege on post-0004 tables.
-- RLS is enabled with no policies (deny-by-default), but belt-and-suspenders:
-- strip any direct grants so only the service role (server code, after its own
-- session + role checks) can touch refresh tokens and personal plans.
revoke all on public.drive_accounts from anon, authenticated;
revoke all on public.plans from anon, authenticated;
revoke all on function public.is_manager() from anon;
