export const dynamic = "force-dynamic";

import { verifySlackRequest, logSlackVerify, viewsOpen, chatPostEphemeral } from "@/lib/slack";
import { linkedEidenUser, mintPairingToken, promptDismissed, recordDismissal, pairingUrl } from "@/lib/slack-links";
import { botIdentity, botRecentFiles, botListFolders } from "@/lib/slack-files";
import { buildShareModal, connectPromptBlocks, type ShareModalState } from "@/lib/slack-modal";
import { rateLimited, clientIp } from "@/lib/rate";

// POST /api/slack/commands — the `/eiden-drive` slash command. Slack signs
// every call (verified first, raw body). Must answer fast: linked users get
// a modal (one views.open call); everyone else gets a private prompt.
// No file data ever flows to unlinked identities.
export async function POST(req: Request) {
  const raw = await req.text();
  const v = await verifySlackRequest(req, raw);
  if (!v.ok) { logSlackVerify("commands", v.error); return Response.json({ response_type: "ephemeral", text: "Couldn't verify that request." }, { status: 200 }); }
  if (rateLimited(`slack-cmd:${clientIp(req)}`, 30)) {
    return Response.json({ response_type: "ephemeral", text: "Slow down — try again in a minute." }, { status: 200 });
  }
  const form = new URLSearchParams(raw);
  const teamId = form.get("team_id") ?? "";
  const userId = form.get("user_id") ?? "";
  const channelId = form.get("channel_id") ?? "";
  const triggerId = form.get("trigger_id") ?? "";
  const command = form.get("command") ?? "";
  if (!teamId || !userId || !channelId || !triggerId) {
    return Response.json({ response_type: "ephemeral", text: "That request was incomplete — try again." }, { status: 200 });
  }

  // `Not now` opt-outs live here too: `/eiden-drive dismiss` records it.
  const text = (form.get("text") ?? "").trim().toLowerCase();
  if (text === "dismiss" || text === "not now" || text === "stop") {
    await recordDismissal(teamId, userId);
    return Response.json({ response_type: "ephemeral", text: "Got it — I won't prompt you again. Run `/eiden-drive` anytime to connect." }, { status: 200 });
  }
  void command;

  const link = await linkedEidenUser(teamId, userId);
  if (!link) {
    const origin = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ?? "";
    if (await promptDismissed(teamId, userId)) {
      // Dismissal suppresses UNSOLICITED prompts — but the user explicitly
      // ran the command, so offer the way back in (button when possible).
      const token = await mintPairingToken(teamId, userId).catch(() => null);
      const url = pairingUrl(origin, teamId, userId, token);
      if (token && url) {
        return Response.json({
          response_type: "ephemeral",
          text: "EIDEN-DRIVE isn't connected yet.",
          blocks: connectPromptBlocks(url),
        }, { status: 200 });
      }
      return Response.json({
        response_type: "ephemeral",
        text: "EIDEN-DRIVE isn't connected. Run `/eiden-drive connect` when you're ready, or use the App Home tab.",
      }, { status: 200 });
    }
    const token = await mintPairingToken(teamId, userId);
    const connectUrl = pairingUrl(origin, teamId, userId, token);
    const posted = await chatPostEphemeral({
      channel: channelId, user: userId,
      text: "Connect EIDEN-DRIVE to Slack to preview files and share them.",
      blocks: connectPromptBlocks(connectUrl),
    });
    if (!posted.ok) {
      return Response.json({ response_type: "ephemeral", text: "Couldn't open the connection prompt — try again." }, { status: 200 });
    }
    return new Response(null, { status: 200 });
  }

  // Linked: open the share modal with recent files (bounded, permissioned).
  // Recent + folders fetch concurrently — trigger_ids are short-lived, so
  // the modal must open inside Slack's ~3s command deadline.
  const me = await botIdentity(link.id);
  if (!me) {
    return Response.json({ response_type: "ephemeral", text: "Your Eiden account is gone or disabled — ask an admin, then reconnect." }, { status: 200 });
  }
  const [recent, topFolders] = await Promise.all([
    botRecentFiles(me, 10).catch(() => []),
    botListFolders(me, null).catch(() => []),
  ]);
  const state: ShareModalState = { channel: channelId, folder: null, folderName: "Workspace", q: "", page: 0, selected: [] };
  const opened = await viewsOpen({
    trigger_id: triggerId,
    view: buildShareModal({ state, folders: topFolders, files: recent, hasMoreFiles: false }),
  });
  if (!opened.ok) {
    return Response.json({ response_type: "ephemeral", text: `Couldn't open the file picker (${opened.error ?? "try again"}).` }, { status: 200 });
  }
  return new Response(null, { status: 200 });
}
