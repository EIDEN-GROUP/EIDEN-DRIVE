-- 0003: real binary uploads via Supabase Storage bucket `eiden-uploads`
-- Apply in Supabase Dashboard > SQL, then create the bucket in Storage > New bucket (private).
alter table file_index add column if not exists storage_path text;
