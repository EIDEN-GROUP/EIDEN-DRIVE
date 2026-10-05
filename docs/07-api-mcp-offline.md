# 07 — API, MCP, offline

API: `GET /api/drive?q=` (merged Google+index), `POST /api/drive/upload|trash|restore`, `GET /api/activity`, `POST /api/vault/unlock (2FA)`, `GET /api/agent/jobs` (agent only, token).

MCP (`mcp-server/`): tools `drive.list/read/upload` scoped `owner==requester`; AI `ai:{user}` add+view PERSONAL only, edit/delete denied + audited. Member toggle `Allow my AI`.

Offline PWA: SW + IndexedDB cache recents/stars, queue mutations, conflict UI (mine/server/both). `public/manifest.json` present.
