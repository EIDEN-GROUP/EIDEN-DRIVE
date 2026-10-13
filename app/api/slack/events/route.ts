export const dynamic = "force-dynamic";

import { verifySlackRequest, chatUnfurl, chatPostEphemeral, appOrigin, parseDriveLink } from "@/lib/slack";
import { linkedEidenUser, mintPairingToken, promptDismissed, recordDismissal } from "@/lib/slack-links";
import { botIdentity, botGetFile, hasLiveShareLink } from "@/lib/slack-files";
import { genericLinkCard, connectPromptBlocks, fileKindLabel, formatBytes } from "@/lib/slack-modal";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { rateLimited, clientIp } from "@/lib/rate";

interface LinkSharedLink { url: string }
interface LinkSharedEvent {
  type: string;
  user?: string;
  channel?: string;
  message_ts?: string;
  bot_id?: string;
  subtype?: string;
  links?: LinkSharedLink[];
  unfurl_id?: string;
}
interface EventsPayload {
  type: string;
  challenge?: string;
  event_id?: string;
  team_id?: string;
  event?: LinkSharedEvent;
}

// POST /api/slack/events — Events API (url_verification + link_shared).
// Verified first (raw body, signing secret, 5-min tolerance). Deliveries are
// retried by Slack: event_ids are recorded (PK) and replays skipped.
// link_shared fires only for USER-authored messages — Slack never sends it
// for bot/app messages, so our own share cards can't self-unfurl (and we
// additionally ignore any event carrying a bot_id).
export async function POST(req: Request) {
  const raw = await req.text();
  const v = await verifySlackRequest(req, raw);
  if (!v.ok) return new Response(null, { status: 401 });
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
  if (eventId && hasAdminClient()) {
    // Idempotency first: replayed deliveries hit the PK and stop here.
    try {
      const { error } = await adminClient().from("slack_event_log").insert({ event_id: eventId });
      if (error) {
        if (/duplicate|unique/i.test(error.message)) return new Response(null, { status: 200 });
        console.warn(`[slack-events] event-log write failed: ${error.message}`);
      }
      // Opportunistic prune (best-effort).
      try {
        await adminClient().from("slack_event_log").delete().lt("created_at", new Date(Date.now() - 7 * 86400_000).toISOString());
      } catch { /* ignore */ }
    } catch (e) {
      console.warn(`[slack-events] event-log check failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  const ev = payload.event;
  // App Home: link status + connect/disconnect, no file data.
  if (ev.type === "app_home_opened") {
    const homeUser = ev.user ?? "";
    const homeTeam = teamId;
    if (homeUser && homeTeam) {
      const link = await linkedEidenUser(homeTeam, homeUser).catch(() => null);
      let eidenUsername: string | null = null;
      if (link && hasAdminClient()) {
        try {
          const { data } = await adminClient().from("profiles").select("username").eq("id", link.id).maybeSingle();
          eidenUsername = ((data ?? {}) as { username?: string }).username ?? null;
        } catch { /* ignore */ }
      }
      const token = link ? null : await mintPairingToken(homeTeam, homeUser).catch(() => null);
      const origin = appOrigin(req);
      const connectUrl = token && origin
        ? `${origin}/slack/connect?token=${token}&workspace=${encodeURIComponent(homeTeam)}&user=${encodeURIComponent(homeUser)}`
        : origin;
      const { homeView } = await import("@/lib/slack-modal");
      const pub = await (await import("@/lib/slack")).slackApi("views.publish", {
        user_id: homeUser, view: homeView({ linked: !!link, eidenUsername, connectUrl }),
      });
      if (!pub.ok) console.warn(`[slack-events] home publish failed: ${pub.error}`);
    }
    return new Response(null, { status: 200 });
  }
  if (ev.type !== "link_shared" || ev.bot_id || ev.subtype === "bot_message") {
    return new Response(null, { status: 200 });
  }
  const channel = ev.channel ?? "";
  const userId = ev.user ?? "";
  const messageTs = ev.message_ts ?? "";
  if (!channel || !userId || !teamId) return new Response(null, { status: 200 });
  // Composer previews (no posted message yet) carry no message_ts — nothing
  // to unfurl against; the posted-message event follows if they send it.
  if (!messageTs) return new Response(null, { status: 200 });

  const origin = appOrigin(req);
  const driveLinks = (ev.links ?? [])
    .map((l) => ({ url: l.url, file: parseDriveLink(l.url, origin) }))
    .filter((l): l is { url: string; file: { fileId: string } } => !!l.file);
  if (!driveLinks.length) return new Response(null, { status: 200 });

  const link = await linkedEidenUser(teamId, userId);
  if (!link) {
    // Unlinked sharer: private connect prompt (never file details), unless
    // dismissed. Recorded dismissals are respected across restarts (DB).
    if (await promptDismissed(teamId, userId)) return new Response(null, { status: 200 });
    const token = await mintPairingToken(teamId, userId);
    const connectUrl = token && origin ? `${origin}/slack/connect?token=${token}&workspace=${encodeURIComponent(teamId)}&user=${encodeURIComponent(userId)}` : origin;
    const posted = await chatPostEphemeral({
      channel, user: userId,
      text: "This looks like an EIDEN-DRIVE link. Connect to preview files.",
      blocks: connectPromptBlocks(connectUrl),
    });
    if (!posted.ok) console.warn(`[slack-events] connect prompt failed: ${posted.error}`);
    return new Response(null, { status: 200 });
  }

  const me = await botIdentity(link.id);
  if (!me) return new Response(null, { status: 200 });

  // Per-link unfurls. Privacy rule: the preview is conversation-visible, so
  // full details appear ONLY for files with a live public share link
  // (intentionally public). Everything else gets the generic card — no
  // filenames, sizes, owners, or paths leak to the channel.
  const unfurls: Record<string, unknown> = {};
  for (const l of driveLinks.slice(0, 5)) {
    const f = await botGetFile(me, l.file.fileId).catch(() => null);
    if (f && (await hasLiveShareLink(f.id).catch(() => false))) {
      const url = `${origin}/drive/${f.id}`;
      unfurls[l.url] = {
        title: f.name.slice(0, 120),
        title_link: url,
        text: `${fileKindLabel(f.mime)} · ${formatBytes(f.size)}`,
        footer: "EIDEN-DRIVE",
        actions: [{ type: "button", text: "Open in Eiden Drive", url }],
      };
    } else {
      unfurls[l.url] = genericLinkCard(origin, l.file.fileId);
    }
  }
  if (Object.keys(unfurls).length) {
    const r = await chatUnfurl({ channel, ts: messageTs, unfurls });
    if (!r.ok) console.warn(`[slack-events] unfurl failed: ${r.error}`);
  }
  return new Response(null, { status: 200 });
}
