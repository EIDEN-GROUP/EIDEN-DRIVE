import type { BotFile } from "@/lib/slack-files";

// /eiden-drive share-modal state. Lives in private_metadata (≤3000 chars):
// only ids + names, never tokens or file contents. Selections cap at 10.
export interface ModalSelection { id: string; name: string }
export interface ShareModalState {
  channel: string;
  folder: string | null;
  folderName: string;
  q: string;
  page: number;
  selected: ModalSelection[];
}

export function encodeModalState(s: ShareModalState): string {
  return JSON.stringify({ ...s, selected: s.selected.slice(0, 10) });
}

export function decodeModalState(raw: string | undefined): ShareModalState | null {
  try {
    const s = JSON.parse(raw ?? "") as Partial<ShareModalState>;
    if (typeof s.channel !== "string" || !s.channel) return null;
    return {
      channel: s.channel,
      folder: typeof s.folder === "string" ? s.folder : null,
      folderName: typeof s.folderName === "string" ? s.folderName : "Workspace",
      q: typeof s.q === "string" ? s.q.slice(0, 120) : "",
      page: Number.isInteger(s.page) && (s.page as number) >= 0 ? (s.page as number) : 0,
      selected: Array.isArray(s.selected)
        ? s.selected.filter((x) => x && typeof x.id === "string" && typeof x.name === "string").slice(0, 10)
        : [],
    };
  } catch {
    return null;
  }
}

const optText = (s: string) => (s.length > 72 ? s.slice(0, 71) + "…" : s);

export function fileOption(f: BotFile): { text: { type: "plain_text"; text: string }; value: string } {
  return { text: { type: "plain_text", text: optText(f.name) }, value: f.id };
}

/** The share modal: search + recent/folder browsing + up-to-10 selection. */
export function buildShareModal(args: {
  state: ShareModalState;
  folders: { id: string; name: string }[];
  files: BotFile[];
  hasMoreFiles: boolean;
  title?: string;
}): Record<string, unknown> {
  const { state, folders, files, hasMoreFiles } = args;
  const selectedIds = new Set(state.selected.map((s) => s.id));
  const blocks: unknown[] = [
    {
      type: "input", block_id: "q_block", optional: true, label: { type: "plain_text", text: "Search files" },
      element: { type: "plain_text_input", action_id: "q_input", initial_value: state.q, placeholder: { type: "plain_text", text: "Name contains…" } },
    },
    {
      type: "actions", block_id: "search_bar",
      elements: [
        { type: "button", action_id: "do_search", text: { type: "plain_text", text: ":mag: Search" }, value: "search" },
        ...(state.folder
          ? [{ type: "button", action_id: "nav_up", text: { type: "plain_text", text: ":arrow_up: Up" }, value: "up" }]
          : []),
      ],
    },
  ];
  if (!state.q && !state.folder) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*Recent files* — or search above, or open a folder:" },
    });
  } else {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: state.q ? `*Results for \`${state.q.replace(/`/g, "")}\`:*` : `*Folder: ${state.folderName.replace(/[*_`]/g, "")}:*` },
    });
  }
  if (!state.q && folders.length) {
    blocks.push({
      type: "actions",
      block_id: "folder_nav",
      elements: folders.slice(0, 10).map((f) => ({
        type: "button", action_id: `nav_folder`, text: { type: "plain_text", text: `:file_folder: ${optText(f.name)}` }, value: f.id,
      })),
    });
  }
  if (files.length) {
    blocks.push({
      type: "input", block_id: "pick_block", optional: true,
      label: { type: "plain_text", text: `Select files (up to 10)${selectedIds.size ? ` — ${selectedIds.size} chosen` : ""}` },
      element: {
        type: "checkboxes", action_id: "pick_files",
        options: files.map(fileOption),
        initial_options: files.filter((f) => selectedIds.has(f.id)).map(fileOption),
      },
    });
  } else {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "_No files here._" } });
  }
  if (hasMoreFiles) {
    blocks.push({
      type: "actions", block_id: "more_bar",
      elements: [{ type: "button", action_id: "more_files", text: { type: "plain_text", text: "Load more…" }, value: "more" }],
    });
  }
  blocks.push({
    type: "input", block_id: "msg_block", optional: true, label: { type: "plain_text", text: "Message (optional)" },
    element: { type: "plain_text_input", action_id: "msg_input", multiline: true, placeholder: { type: "plain_text", text: "Say something about these files…" } },
  });
  return {
    type: "modal",
    callback_id: "eiden_share",
    private_metadata: encodeModalState(state),
    title: { type: "plain_text", text: args.title ?? "Share from Eiden Drive" },
    submit: { type: "plain_text", text: "Share in this conversation" },
    close: { type: "plain_text", text: "Cancel" },
    blocks,
  };
}

/**
 * Merge checkbox toggles: Slack sends the CURRENTLY checked boxes on the
 * visible page only. Selections from other pages persist (carried minus this
 * page's ids, plus what's checked now) — unchecking works, navigating keeps.
 */
export function mergeSelections(
  carried: ModalSelection[],
  pageIds: string[],
  checkedIds: string[],
  knownNames: Map<string, string>
): ModalSelection[] {
  const page = new Set(pageIds);
  const checked = new Set(checkedIds);
  const out = new Map<string, string>();
  for (const s of carried) if (!page.has(s.id)) out.set(s.id, s.name);
  for (const id of checked) out.set(id, knownNames.get(id) ?? out.get(id) ?? id);
  return [...out.entries()].slice(0, 10).map(([id, name]) => ({ id, name }));
}

export function fileKindLabel(mime: string): string {
  if (mime === "application/vnd.google-apps.folder") return "Drive folder";
  if (mime.startsWith("image/")) return "Image";
  if (mime.startsWith("video/")) return "Video";
  if (mime.startsWith("audio/")) return "Audio";
  if (mime === "application/pdf") return "PDF";
  return "File";
}

export function formatBytes(n: number | null): string {
  if (n == null) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${u[i]}`;
}

/**
 * The share message: one compact section per file (name, kind, size, Open
 * button). Rendered by the BOT as its own message — Slack never fires
 * link_shared for app-authored messages, so no unfurl dependency exists.
 */
export function shareMessageBlocks(args: {
  origin: string; files: { id: string; name: string; mime: string; size: number | null; where: string }[];
}): unknown[] {
  const blocks: unknown[] = [];
  for (const f of args.files.slice(0, 10)) {
    const url = `${args.origin}/drive/${f.id}`;
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${f.name.replace(/[*_`]/g, "").slice(0, 120)}*\n${fileKindLabel(f.mime)} · ${formatBytes(f.size)} · ${f.where.replace(/[*_`]/g, "").slice(0, 80)}`,
      },
      accessory: { type: "button", action_id: "open_file", text: { type: "plain_text", text: "Open in Eiden Drive" }, url },
    });
  }
  return blocks;
}

/** Generic link card: branding + Open button, ZERO file metadata (privacy). */
export function genericLinkCard(origin: string, fileId: string): Record<string, unknown> {
  return {
    title: "EIDEN-DRIVE",
    title_link: `${origin}/drive/${fileId}`,
    text: "Shared from EIDEN-DRIVE. Open the link to view it — Eiden Drive permissions apply.",
  };
}

/** App Home tab: link status + connect/disconnect without any file data. */
export function homeView(args: { linked: boolean; eidenUsername?: string | null; connectUrl: string }): Record<string, unknown> {
  return {
    type: "home",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: args.linked
            ? `:white_check_mark: *Connected* — this Slack user is linked${args.eidenUsername ? ` to Eiden Drive account *${args.eidenUsername.replace(/[*_`]/g, "")}*` : ""}. Run \`/eiden-drive\` anywhere to browse and share your files.`
            : "*EIDEN-DRIVE is not connected.* Connect your Eiden Drive account to browse and share files you can access — right from Slack.",
        },
      },
      {
        type: "actions",
        elements: args.linked
          ? [{ type: "button", action_id: "home_disconnect", text: { type: "plain_text", text: "Disconnect" } }]
          : [{ type: "button", action_id: "home_connect", style: "primary", text: { type: "plain_text", text: "Connect Eiden Drive" }, url: args.connectUrl }],
      },
      { type: "context", elements: [{ type: "mrkdwn", text: "Eiden Drive permissions always apply — the bot never shows files you can't access." }] },
    ],
  };
}

/** Connect prompt (private): no file details, ever. */
export function connectPromptBlocks(connectUrl: string): unknown[] {
  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: "*This looks like an EIDEN-DRIVE link.* Connect EIDEN-DRIVE to Slack to preview files and browse and share your files directly from Slack." },
    },
    {
      type: "actions",
      elements: [
        { type: "button", action_id: "slack_connect", style: "primary", text: { type: "plain_text", text: "Connect Eiden Drive" }, url: connectUrl },
        { type: "button", action_id: "slack_dismiss", text: { type: "plain_text", text: "Not now" } },
      ],
    },
  ];
}
