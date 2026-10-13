import { adminClient, hasAdminClient } from "@/lib/supabase-admin";

// Durable Slack event queue (migration 0023 extends the 0022 event log).
//
// Why: Slack demands a 200 within ~3s, but unfurl/prompt work fans out to
// several DB round trips + Slack API calls. The events route therefore only
// verifies + enqueues, and /api/slack/process (Vercel Cron, 5-min) does the
// work with retries. No event is ever marked complete before its work
// succeeds: rows move pending → processing → done, failures return to
// pending with backoff, and only exhausted jobs go dead (with a safe error
// code for admins — never bodies, tokens, or file data).
//
// Pre-migration (0022 only): enqueue degrades to the legacy {event_id}
// insert + synchronous "inline" processing by the route — today's behavior.

export const SLACK_MAX_ATTEMPTS = 8;

export type SlackJobKind = "link_shared" | "app_home";

export interface LinkSharedJobPayload {
  user: string;
  channel: string; // real channel id, or "COMPOSER"
  message_ts: string; // real ts, or the synthetic composer id
  links: string[]; // raw URLs, already filtered to the app origin by the route
  unfurl_id: string | null;
  source: "composer" | "posted";
  is_refresh: boolean;
  origin: string; // canonical app origin captured at enqueue time
}

export interface AppHomeJobPayload {
  user: string;
  origin: string;
}

export type SlackJobPayload = LinkSharedJobPayload | AppHomeJobPayload;

export interface SlackJob {
  event_id: string;
  team_id: string;
  kind: SlackJobKind;
  attempts: number;
  payload: SlackJobPayload;
  prompt_sent: boolean;
  unfurled: boolean;
}

function isSchemaError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e ?? "");
  return /42P01|42703|PGRST202|does not exist|column .* unknown|Could not find/i.test(m);
}

/** Exponential backoff with cap: 30s → 60s → … → 1h (attempts is 1-based). */
export function backoffFor(attempts: number): number {
  return Math.min(30 * 2 ** Math.max(0, attempts - 1), 3600);
}

export type EnqueueResult = "queued" | "duplicate" | "inline" | "dropped";

/**
 * Record an event and decide what the route should do:
 * - "queued": worker will process it — route returns 200 immediately.
 * - "duplicate": already seen (done, queued, processing, or dead) — 200, no work.
 * - "inline": queue schema missing (0022 only) — caller processes
 *   synchronously with legacy dedup, preserving pre-migration behavior.
 * - "dropped": transient DB failure — 200 with no work; Slack's own delivery
 *   retries re-attempt the enqueue. Never processes without dedup.
 */
export async function enqueueSlackEvent(args: {
  event_id: string; team_id: string; kind: SlackJobKind; payload: SlackJobPayload;
}): Promise<EnqueueResult> {
  if (!hasAdminClient() || !args.event_id) return "dropped";
  const db = adminClient();
  try {
    const { error } = await db.from("slack_event_log").insert({
      event_id: args.event_id, team_id: args.team_id, kind: args.kind,
      status: "pending", attempts: 0, next_attempt_at: new Date().toISOString(),
      payload: args.payload, prompt_sent: false, unfurled: false,
      last_error: null, updated_at: new Date().toISOString(),
    });
    if (!error) return "queued";
    if (!/duplicate|unique/i.test(error.message ?? "")) throw new Error(error.message ?? "enqueue failed");
    // Redelivery of a known event: only a retryable failure requeues;
    // pending/processing/done/dead rows are left exactly as they are.
    const { data } = await db.from("slack_event_log")
      .select("status,attempts").eq("event_id", args.event_id).maybeSingle();
    const row = (data ?? null) as { status?: string; attempts?: number } | null;
    if (row?.status === "pending" && (row.attempts ?? 0) > 0) {
      await db.from("slack_event_log").update({ next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("event_id", args.event_id);
      return "queued";
    }
    return "duplicate";
  } catch (e) {
    if (isSchemaError(e)) return enqueueLegacy(args.event_id);
    console.warn(`[slack-queue] enqueue failed (${args.kind}): ${e instanceof Error ? e.message : e}`);
    return "dropped";
  }
}

/** 0022-schema fallback: bare {event_id} insert. Duplicate → skip, else inline. */
async function enqueueLegacy(event_id: string): Promise<EnqueueResult> {
  try {
    const { error } = await adminClient().from("slack_event_log").insert({ event_id });
    if (error) {
      if (/duplicate|unique/i.test(error.message ?? "")) return "duplicate";
      console.warn(`[slack-queue] legacy dedup write failed: ${error.message}`);
      return "dropped";
    }
    return "inline";
  } catch (e) {
    console.warn(`[slack-queue] legacy dedup check failed: ${e instanceof Error ? e.message : e}`);
    return "dropped";
  }
}

interface ClaimRow {
  event_id: string; team_id: string; kind: SlackJobKind; attempts: number;
  payload: SlackJobPayload; prompt_sent: boolean; unfurled: boolean;
}

/**
 * Claim due jobs (pending + due, or processing with a stale heartbeat from a
 * dead worker). The RPC flips them to processing atomically (SKIP LOCKED).
 * Missing function (0022 only) → no queue processing, legacy inline covers it.
 */
export async function claimSlackEvents(limit: number): Promise<SlackJob[]> {
  if (!hasAdminClient()) return [];
  try {
    const { data, error } = await adminClient().rpc("claim_slack_events", { p_limit: Math.max(1, Math.min(limit, 25)) });
    if (error) {
      if (!isSchemaError(error)) console.warn(`[slack-queue] claim failed: ${error.message}`);
      return [];
    }
    return ((data ?? []) as ClaimRow[]).map((r) => ({
      event_id: r.event_id, team_id: r.team_id, kind: r.kind, attempts: r.attempts ?? 0,
      payload: r.payload, prompt_sent: !!r.prompt_sent, unfurled: !!r.unfurled,
    }));
  } catch (e) {
    console.warn(`[slack-queue] claim failed: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

/** Success: done + side-effect flags (exactly-once guards for retries). */
export async function finishSlackEvent(event_id: string, patch: { prompt_sent?: boolean; unfurled?: boolean }): Promise<void> {
  if (!hasAdminClient()) return;
  try {
    await adminClient().from("slack_event_log").update({
      status: "done", ...patch, last_error: null, updated_at: new Date().toISOString(),
    }).eq("event_id", event_id);
  } catch (e) {
    console.warn(`[slack-queue] finish write failed: ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * Failure: retryable → back to pending with backoff; permanent (or attempts
 * exhausted) → dead with a safe code. `code` must be a short category string
 * (e.g. "slack:missing_scope", "db", "no-token") — never bodies or file data.
 */
export async function failSlackEvent(event_id: string, code: string, opts?: { permanent?: boolean }): Promise<void> {
  if (!hasAdminClient()) return;
  const safe = code.slice(0, 120);
  try {
    const db = adminClient();
    const { data } = await db.from("slack_event_log").select("attempts").eq("event_id", event_id).maybeSingle();
    const attempts = (((data ?? {}) as { attempts?: number }).attempts ?? 0) + 1;
    const dead = !!opts?.permanent || attempts >= SLACK_MAX_ATTEMPTS;
    await db.from("slack_event_log").update({
      status: dead ? "dead" : "pending",
      attempts,
      // Dead rows are never claimed (claim only reads pending/processing),
      // so the timestamp is bookkeeping — the column stays NOT NULL.
      next_attempt_at: dead ? new Date().toISOString() : new Date(Date.now() + backoffFor(attempts) * 1000).toISOString(),
      last_error: { code: safe, at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }).eq("event_id", event_id);
    if (dead) console.warn(`[slack-queue] event dead-lettered (${safe})`);
  } catch (e) {
    console.warn(`[slack-queue] fail write failed: ${e instanceof Error ? e.message : e}`);
  }
}
