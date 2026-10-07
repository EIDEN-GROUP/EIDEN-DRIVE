-- 0010: remember each Google entry's parent so the Explorer can render
-- the real Drive folder tree (drives > folders > files) from the index.
alter table file_index add column if not exists google_parent_id text;
