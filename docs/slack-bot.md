# EIDEN-DRIVE Slack Bot — Setup & Operations

Production Slack app for EIDEN-DRIVE (search/browse/share via `/eiden-drive`,
link unfurls, per-user account linking). The existing `SLACK_WEBHOOK_URL`
upload notifications keep working unchanged.

## 1. Slack app configuration (api.slack.com → Your App)

**Basic Information**
- Copy the **Signing Secret** → `SLACK_SIGNING_SECRET` (every callback is HMAC-verified; missing secret = all callbacks rejected).

**OAuth & Permissions → Scopes (minimum set)**
- `commands` — register/invoke `/eiden-drive`
- `chat:write` — post share cards + ephemeral prompts
- `links:read` — receive `link_shared` for registered domains
- `links:write` — `chat.unfurl` previews
- `users:read` — resolve Slack display names for upload notifications (existing feature)
- `incoming-webhook` — only if the install flow itself must provision webhook URLs (the existing static `SLACK_WEBHOOK_URL` needs no scope)

Do NOT add file-upload (`files:write`), channel-history, or admin scopes —
the bot shares by link and reads nothing it doesn't need.

**Slash Commands** — create `/eiden-drive`:
- Request URL: `https://<APP>/api/slack/commands` (HTTPS, POST)

**Interactivity & Shortcuts**
- Request URL: `https://<APP>/api/slack/interactions` (HTTPS, POST)
- No shortcuts needed.

**Event Subscriptions**
- Request URL: `https://<APP>/api/slack/events` (HTTPS, POST)
- Subscribe to bot events: `link_shared`, `app_home_opened`
- **App unfurl domains**: add the production EIDEN-DRIVE hostname (the value of
  `NEXT_PUBLIC_APP_URL`, e.g. `drive.eiden-group.com`) — domain only, no scheme.

**App Home**
- Enable Home tab (bot reads it; no messages tab needed).

**Install**: Install to the workspace, then invite the bot where wanted.
After ANY scope/domain change, **reinstall (or reauthorize)** the app or Slack
keeps serving the old grants (`missing_scope`, silent unfurl failures).

## 2. Environment variables (server-only, Vercel)

| Variable | Purpose |
|---|---|
| `SLACK_SIGNING_SECRET` | Verify every Slack callback (required for bot features) |
| `SLACK_BOT_TOKEN` | `xoxb-…` bot token: modals, posting, unfurl, `users.info` (needs `users:read`) |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Reserved for OAuth install flows (not required for single-workspace installs) |
| `SLACK_REDIRECT_URI` | Reserved ditto (`https://<APP>/api/slack/oauth/callback`) |
| `SLACK_WEBHOOK_URL` | Unchanged: upload-notification channel (without it, uploads still succeed) |
| `NEXT_PUBLIC_APP_URL` | Canonical origin — link detection + Open buttons derive from it (never hard-coded) |

Never expose tokens/secrets/webhook URLs to browser code. Nothing under
`app/slack/` or the APIs above leaks them (verified by test).

## 3. Database

- `0021_slack_user_id` (if not applied): admin-managed Slack identity on `profiles`.
- `0022_slack_bot` (required for bot features): `slack_links` (workspace+user ↔
  Eiden account, dismissals), `slack_pairing` (single-use 15-min tokens),
  `slack_event_log` (delivery idempotency).
- Apply during a maintenance window; never against production without approval.
  Pre-migration behavior: linking/unfurl/picker refuse loudly (`migration_missing`
  style errors); uploads + directory keep working.

## 4. Behavior contract (for reviewers)

- Unlinked identities see **zero** file data anywhere (picker, search, unfurl).
- Unfurls show full details **only** for files with a live public share link;
  everything else gets a metadata-free generic card. No public URLs are ever
  created for thumbnails.
- Share-message previews render inline (Slack sends no `link_shared` for bot
  messages); `link_shared` replays are PK-deduped; bot-authored events ignored.
- Upload notifications carry `unfurl_links: false, unfurl_media: false`
  (scoped to those messages only) and never fail the upload.
- Pairing tokens: random 192-bit, 15-min TTL, atomic single-use, bound to one
  workspace+user; the Eiden session being linked is the signed-in account.
