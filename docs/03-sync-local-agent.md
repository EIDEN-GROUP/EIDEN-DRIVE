# 03 — Sync + Local Agent (router USB)

Browser cannot mount `\\192.168.1.1` securely. Agent (Node exe on office PC with SMB access) dials OUT via WSS+mTLS+token, polls jobs, runs allowlisted ops: list/hash/upload/move/rename/trash/sync.

Flow USB→Google: drop file on USB → agent SHA-256 + index → dashboard shows 💾 badge → user clicks Upload to Google → cloud upload via service account → ☁+💾 badges + audit + version.

Health: online/offline, last sync, storage used, job queue. See `local-agent/src/index.js`, `supabase jobs` table.
