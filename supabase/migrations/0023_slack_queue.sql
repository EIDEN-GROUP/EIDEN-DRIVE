-- 0023: durable Slack event queue (extends the 0022 event log).
--
-- NOT APPLIED AUTOMATICALLY — review and apply during a maintenance window.
-- Do NOT apply against production without approval.
--
-- Why: Slack demands HTTP 200 within ~3s, but prompt/unfurl work fans out to
-- several DB round trips + Slack API calls. The events route now only
-- verifies + enqueues; /api/slack/process (Vercel Cron) claims due rows and
-- does the work with retries. A row is NEVER done before its work succeeds:
-- pending → processing → done, failures return to pending with backoff, and
-- only exhausted jobs go dead (last_error keeps a safe code for admins —
-- never bodies, tokens, or file data).
--
-- Pre-migration behavior: the app falls back to the 0022 bare-{event_id}
-- insert + synchronous processing. Applying this migration switches the
-- routes to queued processing automatically (no code change needed).

alter table if exists slack_event_log
  add column if not exists team_id text,
  add column if not exists kind text not null default 'link_shared',
  add column if not exists status text not null default 'pending',
  add column if not exists attempts int not null default 0,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists payload jsonb,
  add column if not exists prompt_sent boolean not null default false,
  add column if not exists unfurled boolean not null default false,
  add column if not exists last_error jsonb,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists slack_event_log_due_idx
  on slack_event_log (status, next_attempt_at)
  where status in ('pending', 'processing');

-- Atomically claim up to p_limit due jobs: pending rows whose backoff
-- elapsed, plus processing rows whose worker died mid-flight (heartbeat
-- older than 5 minutes). SKIP LOCKED keeps concurrent claimants apart.
create or replace function claim_slack_events(p_limit int)
returns setof slack_event_log
language plpgsql
security definer
as $$
begin
  return query
  update slack_event_log
  set status = 'processing', updated_at = now()
  where event_id in (
    select event_id from slack_event_log
    where (status = 'pending' and next_attempt_at <= now())
       or (status = 'processing' and updated_at < now() - interval '5 minutes')
    order by next_attempt_at
    limit greatest(1, least(p_limit, 25))
    for update skip locked
  )
  returning slack_event_log.*;
end;
$$;
