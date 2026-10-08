# Eiden MCP server (working)

Per-member AI access to FileOS over MCP (stdio). One running instance acts as **one member**.

## Setup

```bash
cd mcp-server
npm install
npm run build
```

## Run

```bash
EIDEN_URL=https://xyzcompany.supabase.co \
EIDEN_SERVICE_KEY=<service-role key, server side only> \
EIDEN_AI_USER_ID=<member profiles.id> \
npm start
```

Then point your agent host (Claude Code, Opencode, any MCP client) at `node dist/index.js` over stdio.

## Rules (enforced server-side, every call)

- The member must have `profiles.allow_ai = true` (migration `0013_allow_ai.sql`) or every tool refuses.
- Tools only ever touch rows where `owner = EIDEN_AI_USER_ID`. Other people's files are invisible — "not found", not "forbidden".
- Uploads land under the member's own Storage prefix, version 1 only. No overwrite, no delete, no trash, no share — those tools don't exist.
- Every call appends to `audit_logs` as `ai:{username}` (`ai-read` / `ai-upload`).

## Tools

| tool | input | notes |
|---|---|---|
| `drive.list` | `q?`, `limit?` (≤100) | own files, newest first |
| `drive.read` | `file_id` (uuid) | metadata + inline text when small & textual (≤100 KB) |
| `drive.upload` | `name`, `bytes_base64` (≤~11 MB raw), `mime?` | storage + index + v1 |

## Test it

```bash
# in one terminal, run the server; in another, speak MCP over stdio:
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | npm start
```
