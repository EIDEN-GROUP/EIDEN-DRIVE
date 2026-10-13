export const dynamic = "force-dynamic";

import { verifySlackRequest, logSlackVerify, viewsUpdate, chatPostMessage } from "@/lib/slack";
import { linkedEidenUser, recordDismissal } from "@/lib/slack-links";
import { botIdentity, botSearchFiles, botRecentFiles, botListFolders, botListFolderFiles, botGetFile, type BotFile } from "@/lib/slack-files";
import { buildShareModal, decodeModalState, mergeSelections, shareMessageBlocks, type ShareModalState } from "@/lib/slack-modal";
import { adminClient } from "@/lib/supabase-admin";
import { rateLimited } from "@/lib/rate";

const PAGE = 10;

interface SlackAction {
  action_id: string; value?: string;
  selected_options?: { value: string }[];
}
interface SlackView {
  id: string; hash?: string;
  private_metadata?: string;
  state?: { values?: Record<string, Record<string, { value?: string; selected_options?: { value: string }[] }>> };
}
interface SlackPayload {
  type: string;
  team?: { id?: string };
  user?: { id?: string };
  channel?: { id?: string };
  view?: SlackView;
  actions?: SlackAction[];
  trigger_id?: string;
}

// POST /api/slack/interactions — modal buttons, checkboxes, submission.
// Verified first (raw body), rate-limited per Slack user. Every file id that
// re-enters here is re-authorized against the linker's live permissions;
// tampered private_metadata only ever degrades to an empty state, never to
// someone else's files (identity always comes from the signed payload).
export async function POST(req: Request) {
  const raw = await req.text();
  const v = await verifySlackRequest(req, raw);
  if (!v.ok) { logSlackVerify("interactions", v.error); return new Response(null, { status: 401 }); }
  const form = new URLSearchParams(raw);
  let payload: SlackPayload;
  try {
    payload = JSON.parse(form.get("payload") ?? "") as SlackPayload;
  } catch {
    return new Response(null, { status: 400 });
  }
  const teamId = payload.team?.id ?? "";
  const userId = payload.user?.id ?? "";
  if (!teamId || !userId) return new Response(null, { status: 400 });
  if (rateLimited(`slack-ix:${teamId}:${userId}`, 60)) return new Response(null, { status: 200 });

  if (payload.type === "block_actions" && payload.actions?.length) {
    // App Home disconnect (no modal involved): only the caller's OWN link.
    if (payload.actions.some((a) => a.action_id === "home_disconnect")) {
      const { linkedEidenUser: who, unbindSlackAccount } = await import("@/lib/slack-links");
      const link = await who(teamId, userId).catch(() => null);
      if (link) await unbindSlackAccount(link.id, teamId, userId).catch(() => null);
      return new Response(null, { status: 200 });
    }
    if (!payload.view) return new Response(null, { status: 200 });
    return handleActions(payload as Required<Pick<SlackPayload, "team" | "user">> & { view: SlackView; actions: SlackAction[]; channel?: { id?: string } });
  }
  if (payload.type === "view_submission" && payload.view) {
    return handleSubmit(payload as { team?: { id?: string }; user?: { id?: string }; view: SlackView });
  }
  return new Response(null, { status: 200 });
}

async function linker(teamId: string, userId: string) {
  const link = await linkedEidenUser(teamId, userId);
  if (!link) return null;
  return botIdentity(link.id);
}

function inputOf(view: SlackView, block: string, action: string): string {
  return view.state?.values?.[block]?.[action]?.value ?? "";
}

function checkedOf(view: SlackView): string[] {
  return view.state?.values?.pick_block?.pick_files?.selected_options?.map((o) => o.value) ?? [];
}

async function folderName(id: string | null): Promise<string> {
  if (!id) return "Workspace";
  try {
    const { data } = await adminClient().from("folders").select("name").eq("id", id).maybeSingle();
    return ((data ?? {}) as { name?: string }).name ?? "Folder";
  } catch {
    return "Folder";
  }
}

async function folderParent(id: string): Promise<string | null> {
  try {
    const { data } = await adminClient().from("folders").select("parent").eq("id", id).maybeSingle();
    return ((data ?? {}) as { parent?: string | null }).parent ?? null;
  } catch {
    return null;
  }
}

interface Listing { folders: { id: string; name: string }[]; files: BotFile[]; hasMore: boolean }

async function listFor(me: NonNullable<Awaited<ReturnType<typeof botIdentity>>>, state: ShareModalState): Promise<Listing> {
  if (state.q) {
    const r = await botSearchFiles(me, state.q, PAGE, state.page * PAGE);
    // botSearchFiles hasMore is approximate under filtering — probe one more.
    return { folders: [], files: r.files, hasMore: r.hasMore };
  }
  if (state.folder) {
    const [folders, r] = await Promise.all([
      botListFolders(me, state.folder),
      botListFolderFiles(me, state.folder, PAGE, state.page * PAGE),
    ]);
    return { folders, files: r.files, hasMore: r.hasMore };
  }
  const recent = await botRecentFiles(me, PAGE);
  const folders = await botListFolders(me, null);
  return { folders, files: recent, hasMore: false };
}

async function handleActions(payload: { team?: { id?: string }; user?: { id?: string }; channel?: { id?: string }; view: SlackView; actions: SlackAction[] }) {
  const teamId = payload.team?.id ?? "";
  const userId = payload.user?.id ?? "";
  const view = payload.view;
  const me = await linker(teamId, userId);
  if (!me) return new Response(null, { status: 200 });
  const state = decodeModalState(view.private_metadata);
  if (!state) return new Response(null, { status: 200 });

  for (const a of payload.actions) {
    if (a.action_id === "slack_dismiss") {
      await recordDismissal(teamId, userId);
      return Response.json({ replace_original: true, text: "Got it — I won't prompt you again. Run `/eiden-drive` anytime to connect." });
    }
  }

  // Merge checkbox state first (every interaction carries current checks).
  const checked = checkedOf(view);
  {
    const probe = await listFor(me, state);
    const pageIds = probe.files.map((f) => f.id);
    const names = new Map(probe.files.map((f) => [f.id, f.name] as [string, string]));
    for (const s of state.selected) names.set(s.id, s.name);
    state.selected = mergeSelections(state.selected, pageIds, checked, names);
  }

  const primary = payload.actions.find((a) => ["do_search", "nav_folder", "nav_up", "more_files"].includes(a.action_id));
  if (primary?.action_id === "do_search") {
    state.q = inputOf(view, "q_block", "q_input").slice(0, 120);
    state.folder = null;
    state.folderName = "Workspace";
    state.page = 0;
  } else if (primary?.action_id === "nav_folder" && primary.value) {
    state.folder = primary.value;
    state.folderName = await folderName(primary.value);
    state.q = "";
    state.page = 0;
  } else if (primary?.action_id === "nav_up") {
    const parent = state.folder ? await folderParent(state.folder) : null;
    state.folder = parent;
    state.folderName = await folderName(parent);
    state.page = 0;
  } else if (primary?.action_id === "more_files") {
    state.page += 1;
  }

  const listing = await listFor(me, state);
  // Page 0 replaces; later pages accumulate (bounded — 5 pages max).
  const files = state.page > 0 ? await listAll(me, state) : listing.files;
  const updated = await viewsUpdate({
    view_id: view.id,
    hash: view.hash,
    view: buildShareModal({ state, folders: listing.folders, files, hasMoreFiles: listing.hasMore }),
  });
  if (!updated.ok) return new Response(null, { status: 200 });
  return new Response(null, { status: 200 });
}

// Full accumulated listing for pages > 0 (bounded: page cap keeps this small).
async function listAll(me: NonNullable<Awaited<ReturnType<typeof botIdentity>>>, state: ShareModalState): Promise<BotFile[]> {
  const out: BotFile[] = [];
  const seen = new Set<string>();
  for (let p = 0; p <= Math.min(state.page, 4); p++) {
    const probe = await listFor(me, { ...state, page: p });
    for (const f of probe.files) {
      if (!seen.has(f.id)) { seen.add(f.id); out.push(f); }
    }
    if (!probe.hasMore) break;
  }
  return out;
}

async function handleSubmit(payload: { team?: { id?: string }; user?: { id?: string }; view: SlackView }) {
  const teamId = payload.team?.id ?? "";
  const userId = payload.user?.id ?? "";
  const view = payload.view;
  const me = await linker(teamId, userId);
  if (!me) return Response.json({ response_action: "clear" });
  const state = decodeModalState(view.private_metadata);
  if (!state) return Response.json({ response_action: "clear" });

  // Final merge: carried selections + whatever is checked on submit.
  const checked = checkedOf(view);
  const ids = [...new Set([...state.selected.map((s) => s.id), ...checked])].slice(0, 10);
  if (!ids.length) {
    return Response.json({ response_action: "errors", errors: { pick_block: "Select at least one file to share." } });
  }
  if (!state.channel) {
    return Response.json({ response_action: "errors", errors: { msg_block: "Lost track of the conversation — reopen the picker with /eiden-drive." } });
  }
  // Re-authorize every id fresh (tampered state can only name ids, never
  // bypass this): missing/invisible rows are skipped and counted. Lookups
  // run concurrently — view_submission must answer inside ~3s.
  const got = await Promise.all(ids.map((id) => botGetFile(me, id).catch(() => null)));
  const files: { id: string; name: string; mime: string; size: number | null; where: string }[] = [];
  let denied = 0;
  // Folder names for the location label (one bounded query, no per-file fan-out).
  const folderIds = new Set<string>();
  const pending: { id: string; name: string; mime: string; size: number | null; folder: string | null }[] = [];
  for (const f of got) {
    if (!f) { denied++; continue; }
    pending.push({ id: f.id, name: f.name, mime: f.mime, size: f.size, folder: f.folder });
    if (f.folder) folderIds.add(f.folder);
  }
  const folderNames = new Map<string, string>();
  if (folderIds.size) {
    try {
      const { data } = await adminClient().from("folders").select("id,name").in("id", [...folderIds].slice(0, 10));
      for (const r of (data ?? []) as { id: string; name: string }[]) folderNames.set(r.id, r.name);
    } catch { /* location falls back below */ }
  }
  for (const p of pending) {
    files.push({ id: p.id, name: p.name, mime: p.mime, size: p.size, where: (p.folder && folderNames.get(p.folder)) || "Eiden Drive" });
  }
  if (!files.length) {
    return Response.json({ response_action: "errors", errors: { pick_block: "Those files aren't accessible anymore — pick others." } });
  }
  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ?? "";
  const msg = inputOf(view, "msg_block", "msg_input").slice(0, 1000);
  const text = `${msg ? `${msg}\n\n` : ""}Shared ${files.length} file${files.length === 1 ? "" : "s"} from EIDEN-DRIVE${denied ? ` (${denied} skipped — no access)` : ""}`;
  const posted = await chatPostMessage({
    channel: state.channel || "",
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: text.slice(0, 2900) } },
      ...shareMessageBlocks({ origin, files }),
    ],
  });
  if (!posted.ok) {
    return Response.json({ response_action: "errors", errors: { msg_block: `Couldn't post (${posted.error ?? "try again"}).` } });
  }
  return Response.json({ response_action: "clear" });
}
