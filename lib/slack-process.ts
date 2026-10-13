import { hasAdminClient } from "@/lib/supabase-admin";
import { chatUnfurl, chatPostEphemeral, slackApi, parseDriveLink } from "@/lib/slack";
import { linkedEidenUser, mintPairingToken, promptDismissed, pairingUrl } from "@/lib/slack-links";
import { botIdentity, botGetFile, hasLiveShareLink } from "@/lib/slack-files";
import { genericLinkCard, connectPromptBlocks, fileKindLabel, formatBytes, homeView } from "@/lib/slack-modal";
import type { SlackJob, LinkSharedJobPayload, AppHomeJobPayload } from "@/lib/slack-queue";

// Worker-side event processing (claimed by /api/slack/process, NOT the
// delivery request — Slack's ~3s deadline is met by the enqueue in the
// events route). Every function here is side-effect-guarded by the job row:
// prompt_sent / unfurled flags make retried jobs skip completed steps, so
// retries never double-prompt, double-unfurl, or double-post.
//
// Privacy is identical to the old inline path: unlinked identities see zero
// file data; conversation-visible previews carry full details ONLY for files
// with a live public share link; everything else gets the metadata-free
// generic card. Degraded mode (DB down) can only produce prompts and generic
// cards — never filenames, sizes, owners, or paths.

/** Throw to fail the job: retryable with backoff, or permanent (dead-letter). */
export class JobFail extends Error {
  code: string;
  permanent: boolean;
  constructor(code: string, permanent = false) {
    super(code);
    this.code = code.slice(0, 80);
    this.permanent = permanent;
  }
}

const slackCode = (error?: string) => `slack:${(error ?? "unknown").slice(0, 60)}`;

function requireConfigured(): void {
  if (!hasAdminClient()) throw new JobFail("unconfigured", true);
}

/** Unique drive file ids from the stored raw URLs (foreign domains drop out). */
function driveFileIds(links: string[], origin: string): string[] {
  const out = new Set<string>();
  for (const url of links.slice(0, 5)) {
    const f = parseDriveLink(url, origin);
    if (f) out.add(f.fileId);
  }
  return [...out];
}

export async function runLinkShared(job: SlackJob & { payload: LinkSharedJobPayload }): Promise<{ prompt_sent?: boolean; unfurled?: boolean }> {
  requireConfigured();
  const p = job.payload;
  const teamId = job.team_id;
  const userId = p.user;
  if (!teamId || !userId) throw new JobFail("bad-payload", true);

  const fileIds = driveFileIds(p.links, p.origin);
  if (!fileIds.length) return {}; // foreign-domain only — nothing to do.

  const link = await linkedEidenUser(teamId, userId);
  if (!link) {
    if (job.prompt_sent) return {}; // retry after a sent prompt — no duplicate.
    if (await promptDismissed(teamId, userId)) return {}; // respected silently.
    const token = await mintPairingToken(teamId, userId);
    if (!token) throw new JobFail("db"); // transient — retry; token rows sweep themselves.
    const url = pairingUrl(p.origin, teamId, userId, token);
    if (p.source === "composer") {
      // Composer previews have no real channel/ts (channel "COMPOSER" +
      // synthetic message_ts) — ordinary message APIs FAIL there. Slack's
      // native auth-prompt parameters on chat.unfurl are the supported
      // vehicle: unfurl_id + source pair, no preview content attached.
      if (!p.unfurl_id) return {};
      const r = await chatUnfurl({
        unfurl_id: p.unfurl_id, source: "composer",
        user_auth_required: true,
        user_auth_message: "Connect EIDEN-DRIVE to preview this file and share your files from Slack.",
        user_auth_url: url,
      });
      if (!r.ok) throw new JobFail(slackCode(r.error));
      return { prompt_sent: true };
    }
    const posted = await chatPostEphemeral({
      channel: p.channel, user: userId,
      text: "This looks like an EIDEN-DRIVE link. Connect to preview files.",
      blocks: connectPromptBlocks(url),
    });
    if (!posted.ok) throw new JobFail(slackCode(posted.error));
    return { prompt_sent: true };
  }

  const me = await botIdentity(link.id);
  if (!me) throw new JobFail("no-identity", true); // account gone — permanent.

  // Per-link unfurls. Full details ONLY for intentionally-public files.
  const unfurls: Record<string, unknown> = {};
  for (const fileId of fileIds) {
    const f = await botGetFile(me, fileId).catch(() => null);
    const original = p.links.find((u) => parseDriveLink(u, p.origin)?.fileId === fileId);
    if (!original) continue;
    if (f && (await hasLiveShareLink(f.id).catch(() => false))) {
      const url = `${p.origin}/drive/${f.id}`;
      unfurls[original] = {
        title: f.name.slice(0, 120),
        title_link: url,
        text: `${fileKindLabel(f.mime)} · ${formatBytes(f.size)}`,
        footer: "EIDEN-DRIVE",
        actions: [{ type: "button", text: "Open in Eiden Drive", url }],
      };
    } else {
      unfurls[original] = genericLinkCard(p.origin, fileId);
    }
  }
  if (!Object.keys(unfurls).length) return {};
  const target = p.source === "composer" && p.unfurl_id
    ? { unfurl_id: p.unfurl_id, source: "composer" as const }
    : { channel: p.channel, ts: p.message_ts };
  const r = await chatUnfurl({ ...target, unfurls });
  if (!r.ok) throw new JobFail(slackCode(r.error));
  return { unfurled: true };
}

export async function runAppHome(job: SlackJob & { payload: AppHomeJobPayload }): Promise<{}> {
  requireConfigured();
  const teamId = job.team_id;
  const userId = job.payload.user;
  if (!teamId || !userId) throw new JobFail("bad-payload", true);
  const link = await linkedEidenUser(teamId, userId).catch(() => null);
  let eidenUsername: string | null = null;
  if (link) {
    try {
      const { adminClient } = await import("@/lib/supabase-admin");
      const { data } = await adminClient().from("profiles").select("username").eq("id", link.id).maybeSingle();
      eidenUsername = ((data ?? {}) as { username?: string }).username ?? null;
    } catch { /* ignore */ }
  }
  const token = link ? null : await mintPairingToken(teamId, userId).catch(() => null);
  if (!link && !token) throw new JobFail("db");
  const url = pairingUrl(job.payload.origin, teamId, userId, token);
  const pub = await slackApi("views.publish", {
    user_id: userId, view: homeView({ linked: !!link, eidenUsername, connectUrl: url }),
  });
  if (!pub.ok) throw new JobFail(slackCode(pub.error));
  return {};
}
