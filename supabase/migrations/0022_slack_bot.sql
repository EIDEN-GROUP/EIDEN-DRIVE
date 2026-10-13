-- 0022: Slack bot account linking, pairing tokens, event idempotency.
--
-- NOT APPLIED AUTOMATICALLY — review and apply during a maintenance window.
-- Do NOT apply against production without approval.
--
-- slack_links binds one Slack identity (workspace + user) to one Eiden
-- account. eiden_user_id is nullable so "Not now" dismissals (workspace +
-- Slack user known, Eiden account unknown) have a home without inventing an
-- account. Partial unique index keeps one Eiden account to one Slack identity
-- per workspace while allowing many dismissed (unlinked) rows.
create table if not exists slack_links (
  workspace_id text not null,
  slack_user_id text not null,
  eiden_user_id uuid references profiles(id),
  linked_at timestamptz,
  dismissed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, slack_user_id)
);
create unique index if not exists slack_links_eiden_uidx
  on slack_links (workspace_id, eiden_user_id)
  where eiden_user_id is not null;

-- Single-use pairing nonces for the Connect flow: minted server-side, bound
-- to one workspace + Slack user, expire after 15 minutes, consumed on use.
create table if not exists slack_pairing (
  token text primary key,
  workspace_id text not null,
  slack_user_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists slack_pairing_expiry_idx
  on slack_pairing (expires_at);

-- Slack event-delivery idempotency: Slack retries deliveries, so every
-- processed event_callback id is recorded; replays hit the PK and are
-- skipped. Old rows are pruned opportunistically by the events route.
create table if not exists slack_event_log (
  event_id text primary key,
  created_at timestamptz not null default now()
);
