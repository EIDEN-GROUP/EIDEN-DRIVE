export const dynamic = "force-dynamic";

import { verifySlackRequest, logSlackVerify, appOrigin, parseDriveLink } from "@/lib/slack";
import { enqueueSlackEvent, finishSlackEvent, failSlackEvent, type SlackJob, type LinkSharedJobPayload, type AppHomeJobPayload } from "@/lib/slack-queue";
import { runLinkShared, runAppHome, JobFail } from "@/lib/slack-process";
import { rateLimited, clientIp } from "@/lib/rate";

interface LinkSharedEvent {
  type: string;
  user?: string;
  channel?: string;
  message_ts?: string;
  bot_id?: string;
  subtype?: string;
  links?: { url: string }[];
  unfurl_id?: string;
  source?: string;
}
interface EventsPayload {
  type: string;
  challenge?: string;
  event_id?: string;
  team_id?: string;
  event?: LinkSharedEvent;
}

// POST /api/slack/events — Events API (url_verification + link_shared +
// app_home_opened). Verified first (raw body, signing secret, 5-min
// tolerance), then deduplicated via the event queue and processed.
//
// Hobby-plan note: this deployment has no frequent worker (Vercel Hobby
// crons run at most daily), so each event is processed inline right after
// its dedup insert — typical cost is a few bounded DB + Slack calls (~1-2s,
// inside Slack's ~3s deadline in the normal case). If a delivery ever
// breaches the deadline, Slack redelivers and the enqueue dedups it; the
// daily /api/slack/process sweep retries anything left pending/failed and
// prunes finished rows. (On Pro: tighten vercel.json to "*/5 * * * *" and
// return 200 right after enqueue instead of running inline.)
//
// link_shared fires only for USER-authored messages — Slack never sends it
// for bot/app messages, so our own share cards can't self-unfurl (and we
// additionally ignore any event carrying a bot_id).
export async function POST(req: Request) {
  const raw = await req.text();
  const v = await verifySlackRequest(req, raw);
  if (!v.ok) { logSlackVerify("events", v.error); return new Response(null, { status: 401 }); }
  let payload: EventsPayload;
  try {
    payload = JSON.parse(raw) as EventsPayload;
  } catch {
    return new Response(null, { status: 400 });
  }
  if (payload.type === "url_verification") {
    return Response.json({ challenge: payload.challenge ?? "" });
  }
  if (payload.type !== "event_callback" || !payload.event) return new Response(null, { status: 200 });
  if (rateLimited(`slack-ev:${clientIp(req)}`, 120)) return new Response(null, { status: 200 });

  const eventId = payload.event_id ?? "";
  const teamId = payload.team_id ?? "";
  if (!eventId || !teamId) return new Response(null, { status: 200 });
  const ev = payload.event;
  if (ev.bot_id || ev.subtype === "bot_message") return new Response(null, { status: 200 });

  const origin = appOrigin(req);

  if (ev.type === "app_home_opened") {
    const user = ev.user ?? "";
    if (!user) return new Response(null, { status: 200 });
    await dispatch({ event_id: eventId, team_id: teamId, kind: "app_home", payload: { user, origin } });
    return new Response(null, { status: 200 });
  }

  if (ev.type !== "link_shared") return new Response(null, { status: 200 });

  // Composer vs posted (per current Events API docs): composer previews
  // carry channel "COMPOSER", a synthetic message_ts, unfurl_id, and
  // source "composer". Enterprise workspaces may omit source/unfurl_id —
  // the channel sentinel is the fallback signal.
  const isComposer = ev.source === "composer" || (!ev.source && ev.channel === "COMPOSER");
  const userId = ev.user ?? "";
  if (!userId) return new Response(null, { status: 200 });
  if (isComposer && !ev.unfurl_id) return new Response(null, { status: 200 });
  if (!isComposer && (!ev.channel || !ev.message_ts || ev.channel === "COMPOSER")) {
    return new Response(null, { status: 200 });
  }
  // Foreign-domain links never reach the queue (parsed against the canonical
  // origin — never hard-coded, so staging and production match only theirs).
  const urls = (ev.links ?? []).map((l) => l.url).filter((u) => parseDriveLink(u, origin));
  if (!urls.length) return new Response(null, { status: 200 });

  const jobPayload: LinkSharedJobPayload = {
    user: userId,
    channel: isComposer ? "COMPOSER" : (ev.channel ?? ""),
    message_ts: ev.message_ts ?? "",
    links: urls.slice(0, 5),
    unfurl_id: ev.unfurl_id ?? null,
    source: isComposer ? "composer" : "posted",
    is_refresh: (ev as { is_unfurl_refresh?: boolean }).is_unfurl_refresh === true,
    origin,
  };
  await dispatch({ event_id: eventId, team_id: teamId, kind: "link_shared", payload: jobPayload });
  return new Response(null, { status: 200 });
}

// Enqueue for the record, then run inline — the Hobby-plan deployment has
// no frequent worker (cron is daily, see vercel.json), so waiting for it
// would stall previews up to 24h. The enqueue still dedups Slack redeliveries
// and records retries; failures are marked failed-with-backoff for the daily
// sweep (or the next redelivery) instead of being lost.
// Pre-migration (0022 schema only) this is the legacy bare-event insert +
// synchronous processing — today's behavior, unchanged.
async function dispatch(job: { event_id: string; team_id: string; kind: "link_shared"; payload: LinkSharedJobPayload } | { event_id: string; team_id: string; kind: "app_home"; payload: AppHomeJobPayload }) {
  const verdict = await enqueueSlackEvent(job);
  if (verdict === "dropped") {
    // Transient DB failure: 200 with no work (Slack's own redelivery
    // re-attempts the enqueue). Loud in logs so an outage is visible.
    console.warn(`[slack-events] ${job.kind} ${job.event_id} dropped (database unavailable)`);
    return;
  }
  if (verdict === "duplicate") return;
  const full: SlackJob = {
    event_id: job.event_id, team_id: job.team_id, kind: job.kind,
    attempts: 0, payload: job.payload, prompt_sent: false, unfurled: false,
  };
  try {
    const patch = job.kind === "link_shared"
      ? await runLinkShared({ ...full, payload: job.payload })
      : await runAppHome({ ...full, payload: job.payload });
    // Queue schema present: record completion so retries skip finished work.
    // Legacy schema: finish/fail would warn on missing columns — skip it
    // (the bare-event insert already dedups).
    if (verdict === "queued") await finishSlackEvent(job.event_id, patch);
  } catch (e) {
    const fail = e instanceof JobFail ? e : new JobFail("unknown");
    if (verdict === "queued") await failSlackEvent(job.event_id, fail.code, { permanent: fail.permanent });
    else console.warn(`[slack-events] inline ${job.kind} failed (${fail.code})`);
  }
  if (verdict !== "queued") {
    // Legacy-schema prune (0022 rows have no status columns, so the worker's
    // status-scoped prune can't see them). Fire-and-forget — never delays the
    // ack; the worker owns pruning once 0023 is applied.
    try {
      const { adminClient } = await import("@/lib/supabase-admin");
      adminClient().from("slack_event_log").delete()
        .lt("created_at", new Date(Date.now() - 7 * 86400_000).toISOString())
        .then(() => {}, () => {});
    } catch { /* ignore */ }
  }
}
