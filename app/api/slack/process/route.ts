export const dynamic = "force-dynamic";
// Worker batch: 5 bounded jobs fit comfortably; unfinished claims keep their
// fresh heartbeat and are reclaimed by the next run after 5 min stale.
export const maxDuration = 60;

import { getProfile, can } from "@/lib/roles";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { claimSlackEvents, finishSlackEvent, failSlackEvent } from "@/lib/slack-queue";
import { runLinkShared, runAppHome, JobFail } from "@/lib/slack-process";
import type { LinkSharedJobPayload, AppHomeJobPayload } from "@/lib/slack-queue";

const CLAIM = 5;

// POST /api/slack/process — cron worker for queued Slack events (Vercel
// Cron, 5-min; see vercel.json). Claims due jobs and runs them with retries.
// Guard: Vercel Cron's CRON_SECRET bearer, or an admin session for manual
// "process now" runs. Returns a summary (never secrets or file data).
export async function POST(req: Request) {
  if (!(await allowed(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  if (!hasAdminClient()) return Response.json({ error: "server not configured" }, { status: 503 });

  const jobs = await claimSlackEvents(CLAIM);
  const summary = { claimed: jobs.length, done: 0, retried: 0, dead: 0 };
  for (const job of jobs) {
    try {
      const patch = job.kind === "link_shared"
        ? await runLinkShared({ ...job, payload: job.payload as LinkSharedJobPayload })
        : await runAppHome({ ...job, payload: job.payload as AppHomeJobPayload });
      await finishSlackEvent(job.event_id, patch);
      summary.done++;
    } catch (e) {
      const fail = e instanceof JobFail ? e : new JobFail("unknown");
      await failSlackEvent(job.event_id, fail.code, { permanent: fail.permanent });
      if (fail.permanent) summary.dead++;
      else summary.retried++;
    }
  }
  // Opportunistic prune (best-effort): finished rows older than 7 days.
  try {
    await adminClient().from("slack_event_log").delete()
      .in("status", ["done", "dead"])
      .lt("created_at", new Date(Date.now() - 7 * 86400_000).toISOString());
  } catch { /* ignore */ }
  return Response.json({ ok: true, ...summary });
}

async function allowed(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get("authorization") ?? "";
  if (secret && auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length);
    if (token.length === secret.length) {
      let diff = 0;
      for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ token.charCodeAt(i);
      if (diff === 0) return true;
    }
    return false; // wrong bearer — don't fall through to session check.
  }
  try {
    const me = await getProfile();
    return !!me && can(me.role, "admin-only");
  } catch {
    return false;
  }
}
