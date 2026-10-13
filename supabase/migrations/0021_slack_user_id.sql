-- 0021: Slack account mapping for upload notifications.
--
-- NOT APPLIED AUTOMATICALLY — a storage admin reviews and applies this during
-- a maintenance window. Do NOT apply against production without approval.
--
-- Nullable: users without a linked Slack ID keep working normally. The unique
-- index treats NULLs as distinct (many unlinked users coexist); duplicate
-- non-null mappings are rejected by the API with a 409 (and by this index as
-- a backstop against check-then-write races).
alter table public.profiles add column if not exists slack_user_id text;
create unique index if not exists profiles_slack_user_id_uidx
  on public.profiles (slack_user_id);
