-- 0017: profile pictures get their own private bucket `eiden-pfp` + a
-- storage_bucket column so file rows can live in either bucket.
-- Apply in Supabase Dashboard > SQL BEFORE deploying the code that reads it
-- (all changes are additive, so running it early is safe).
insert into storage.buckets (id, name, public)
values ('eiden-pfp', 'eiden-pfp', false)
on conflict (id) do nothing;

alter table file_index add column if not exists storage_bucket text;
-- NULL = legacy `eiden-uploads` bucket. Only avatar rows (and future
-- non-upload buckets) carry 'eiden-pfp'. No backfill: every read falls back
-- to eiden-uploads when the column is NULL.
