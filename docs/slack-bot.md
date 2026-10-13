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
- `users:read` — resolve Slack display names for upload notifications
- `incoming-webhook` — only if the install flow itself must provision webhook URLs (the existing static `SLACK_WEBHOOK_URL` needs no scope)

Do NOT add file-upload (`files:write`), channel-history, or admin scopes —
the bot shares by link and reads nothing it doesn't need.

**Slash Commands** — create `/eiden-drive`:
- Request URL: `https://drive.eiden-group.com/api/slack/commands` (HTTPS, POST)

**Interactivity & Shortcuts**
- Request URL: `https://drive.eiden-group.com/api/slack/interactions` (HTTPS, POST)
- No shortcuts needed.

**Event Subscriptions**
- Request URL: `https://drive.eiden-group.com/api/slack/events` (HTTPS, POST)
- It must verify with the `challenge` handshake — the middleware allowlist
  lets this URL through with no Eiden session; the route still HMAC-verifies
  every delivery including the challenge itself.
- Subscribe to bot events: `link_shared`, `app_home_opened`
- **App unfurl domains**: `drive.eiden-group.com` — domain only, no scheme.
  This must equal the host of `NEXT_PUBLIC_APP_URL`, or links never match.

**App Home**
- Enable Home tab (link status + connect/disconnect; no messages tab needed).

**Install**: Install to the workspace, then invite the bot where wanted.
After ANY scope/domain change, **reinstall (or reauthorize)** the app or Slack
keeps serving the old grants (`missing_scope`, silent unfurl failures).

## 2. Environment variables (server-only, Vercel)

| Variable | Purpose |
|---|---|
| `SLACK_SIGNING_SECRET` | Verify every Slack callback (required for bot features) |
| `SLACK_BOT_TOKEN` | `xoxb-…` bot token: modals, posting, unfurl, `users.info` |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Reserved for OAuth install flows (not required for single-workspace installs) |
| `SLACK_REDIRECT_URI` | Reserved ditto |
| `SLACK_WEBHOOK_URL` | Unchanged: upload-notification channel (without it, uploads still succeed) |
| `NEXT_PUBLIC_APP_URL` | Canonical origin — must be `https://drive.eiden-group.com` in production; link detection + Open buttons derive from it (never hard-coded) |
| `CRON_SECRET` | Guard for the event worker (`POST /api/slack/process`); Vercel Cron sends it as the bearer automatically |

Verify each of these in **Vercel → Project → Settings → Environment
Variables (Production)** — `.env.example` documents names only, never values.
Never expose tokens/secrets/webhook URLs to browser code.

## 3. Database

- `0021_slack_user_id` (if not applied): admin-managed Slack identity on `profiles`.
- `0022_slack_bot` (required for bot features): `slack_links` (workspace+user ↔
  Eiden account, dismissals), `slack_pairing` (single-use 15-min tokens),
  `slack_event_log` (delivery idempotency).
- `0023_slack_queue` (required for queued processing): extends
  `slack_event_log` with status/attempts/backoff/payload/side-effect flags plus
  the `claim_slack_events()` worker function.
- Apply during a maintenance window; never against production without approval.
  Pre-0023 behavior: the events route falls back to the 0022 bare-event insert
  + synchronous processing (today's behavior, unchanged). Uploads + directory
  keep working with none of these applied.

## 4. How event processing works

- `POST /api/slack/events` verifies the signature, then **acks fast** (HTTP 200
  well inside Slack's ~3s deadline) and enqueues the event. No DB fan-out or
  Slack API call happens before the ack.
- `POST /api/slack/process` (Vercel Cron every 5 min per `vercel.json`, or an
  admin session for manual "process now") claims due jobs and runs them with
  exponential-backoff retries (8 attempts max). Rows move
  pending → processing → done; failures return to pending; exhausted jobs go
  dead with a safe error code visible to admins. Retried jobs skip completed
  side effects (no duplicate prompts/unfurls/posts).
- Slack redeliveries of known events are deduped; redelivery of a *failed*
  event requeues it sooner.
- **Cron prerequisite**: sub-daily schedules need a paid Vercel plan. If cron
  never fires, events pile up pending — the Storage → Slack health panel shows
  the database state, and admins can trigger `/api/slack/process` manually.

## 5. Behavior contract (for reviewers)

- Unlinked identities see **zero** file data anywhere (picker, search, unfurl).
- Posted-message links unfurl via channel+ts; composer previews via
  unfurl_id+source (the `COMPOSER` channel + synthetic ts never go to ordinary
  message APIs — those calls would fail).
- Unlinked composer shares get Slack's native auth prompt (`user_auth_*` on
  `chat.unfurl`); unlinked posted shares get a private ephemeral. Dismissals
  suppress unsolicited prompts; running `/eiden-drive` explicitly always offers
  the way back in.
- Unfurls show full details **only** for files with a live public share link;
  everything else gets a metadata-free generic card. No public URLs are ever
  created for thumbnails.
- Share-message previews render inline (Slack sends no `link_shared` for bot
  messages); bot-authored events are ignored.
- Upload notifications carry `unfurl_links: false, unfurl_media: false`
  (scoped to those messages only) and never fail the upload.
- Pairing tokens: random 192-bit, 15-min TTL, atomic single-use, bound to one
  workspace+user; the Eiden session being linked is the signed-in account.
- Health: `GET /api/integrations/slack` (admins) reports webhook, bot token
  (live `auth.test`), signing secret, app URL, and migration readiness
  separately. The webhook flag alone never means "the bot works".
