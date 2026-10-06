# 07 — API, MCP, offline

API: `GET /api/drive?q=` (merged Google+index), `POST /api/drive/upload|trash|restore|sync` (sync = manager+, full Google pull), `PATCH /api/drive/rename` (members+), `GET /api/drive/bin|download`, `GET|POST|PATCH|DELETE /api/folders` (rename members+, delete manager+ empty-only), `GET|PATCH|DELETE /api/users` + `POST /api/users/invite`, `POST /api/access-requests` (public request-access inbox, anon insert, manager triage), `GET /api/activity`, `POST /api/vault/unlock (2FA)`, `POST /api/agent` (agent heartbeat + pending jobs, `Authorization: Bearer AGENT_TOKEN`, 503 if unset), `GET /api/agent` (managers: recent jobs), `POST /api/vault/enroll` (start TOTP setup), `GET|POST /api/storage` (live quotas+jobs, backup-check trigger manager+), `GET /api/notifications`. Auth: Supabase magic link (invite-only, `shouldCreateUser:false`) + Google SSO + optional email/password (set under account menu → Set password).

MCP (`mcp-server/`): tools `drive.list/read/upload` scoped `owner==requester`; AI `ai:{user}` add+view PERSONAL only, edit/delete denied + audited. Member toggle `Allow my AI`.

Offline PWA: SW + IndexedDB cache recents/stars, queue mutations, conflict UI (mine/server/both). `public/manifest.json` present.
