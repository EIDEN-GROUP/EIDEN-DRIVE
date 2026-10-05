# EIDEN-DRIVE — Eiden Group FileOS

Unified web app over **Google Shared Drives (primary cloud)** + **Router-USB staging via Local Agent**. One drive UI, safe-delete, full audit, encrypted vault, offline PWA.

## Quick start

1. Fill env **at the end** (`cp .env.example .env.local`): Supabase, Google (client/secret/refresh/Shared Drive ID), `AGENT_TOKEN`, `AGENT_WS_URL`.
2. `npm install && npm run dev` → `/drive` (login at `/login`).
3. DB: `supabase db push` (`supabase/migrations/0001_init.sql` + `0002_ai_vault.sql`).
4. Agent (office PC): `cd local-agent && npm i && node src/index.js` — see `local-agent/README.md`. Mount `\\192.168.1.1\share` first.
5. MCP: see `mcp-server/README.md` + `src/index.ts` (AI add+view private only).
6. Spec: `docs/00-index.md` → `01…09`.

## What is implemented (P0–P2 code-complete, creds pending)

* `app/drive` browser + filters (type/storage/search) + inspector + `/drive/[id]` preview/versions/timeline
* `app/activity|security|vault|users|storage` full pages + widgets
* APIs: `drive` (merged index+Google), `drive/trash` (Recovery Bin 90d + approvals), `drive/restore` (manager+), `drive/upload`, `drive/webhook`, `activity`, `vault/unlock` (TOTP/WebAuthn stub → verify at the end, 6h session), `users` (manager-only tags), `storage` (80/95% alerts), `agent` (token heartbeat+jobs), `notifications`
* Lib: `roles`, `audit` (IP/browser/OS + agent MAC), `google-drive` (list/trash/restore/share-expiry), `vault` (AES-GCM + 6h), `alerts`, `files`, `offline` (IndexedDB outbox + `public/sw.js`)
* `local-agent` outbound-only indexer + allowlisted ops; `mcp-server` scoped tools

## Structure

```
app/(auth|drive|drive/[id]|activity|security|vault|users|storage|api/...)  Next.js 14 TS
components/drive|ui  lib/  supabase/migrations/  local-agent/  mcp-server/
docs/00-09  design-system/Eiden-Drive/MASTER.md  public/{logo.svg,manifest.json,sw.js}
```

## Rules (enforced)

* USB never on internet; agent dials out (WSS/token). Members trash-only; permanent = dual-admin + approval on Finance/Legal/Contracts/HR. Vault create = Manager/Admin; view = fresh 2FA, 6h. Theme: `#122620/#0C5752/#CFC292/#FEFFF8` + Design.md tokens.
