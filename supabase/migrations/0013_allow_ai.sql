-- 0013: per-member AI opt-in for the MCP server.
-- The MCP server refuses every call unless the bound member has allow_ai = true.
alter table profiles add column if not exists allow_ai boolean not null default false;
