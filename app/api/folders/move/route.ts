export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { folderUsable, isFolderBinned } from "@/lib/visibility";
import { subtreeIds } from "@/lib/folders";
import { parseJson, dbError } from "@/lib/http";

const Body = z.object({
  folder_id: z.string().uuid(),
  // Local workspace destination (null = top level). Drive folders move via
  // /api/drive/move (google_parent) — this route only rewrites the local
  // parent link, so cross-drive smuggling is impossible by construction.
  parent: z.string().uuid().nullable(),
});

// Cut + paste for local Workspace folders: relocates the folder with its
// whole subtree (files keep their rows/bytes, hierarchy preserved). Members
// need write access to the source and the destination; a move is refused when
// any nested folder is outside their department, when either side is binned,
// or when the destination sits inside the moved folder itself.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  const db = adminClient();
  const { data: f } = await db.from("folders").select("id,name,parent").eq("id", p.data.folder_id).maybeSingle();
  if (!f) return Response.json({ error: "folder not found" }, { status: 404 });
  if (await isFolderBinned(db, p.data.folder_id)) {
    return Response.json({ error: "that folder is in the Recovery Bin — restore it instead of moving it", code: "is_binned" }, { status: 409 });
  }
  const src = await folderUsable(db, me, p.data.folder_id);
  if (!src.ok) return Response.json({ error: src.reason ?? "not allowed", code: "forbidden" }, { status: 403 });
  if (p.data.parent) {
    const { data: dst } = await db.from("folders").select("id").eq("id", p.data.parent).maybeSingle();
    if (!dst) return Response.json({ error: "destination folder not found", code: "dest_missing" }, { status: 404 });
    // No pasting a folder inside itself or one of its descendants (cycle).
    let cur: string | null = p.data.parent;
    const seen = new Set<string>();
    for (let i = 0; i < 50 && cur && !seen.has(cur); i++) {
      if (cur === p.data.folder_id) {
        return Response.json({ error: "can't move a folder inside itself or its own subfolder", code: "self_descendant" }, { status: 400 });
      }
      seen.add(cur);
      const got = (await db.from("folders").select("parent").eq("id", cur).maybeSingle()) as unknown as { data: { parent?: string | null } | null };
      cur = got.data?.parent ?? null;
    }
    const gate = await folderUsable(db, me, p.data.parent);
    if (!gate.ok) return Response.json({ error: gate.reason ?? "not allowed", code: "forbidden" }, { status: 403 });
  }
  // The whole subtree moves along: every nested folder must be writable too,
  // or a move would smuggle another department's tree to a new location.
  const order = await subtreeIds(db, p.data.folder_id);
  if (!order) return Response.json({ error: "couldn't read the folder contents" }, { status: 500 });
  for (const id of order) {
    if (id === p.data.folder_id) continue;
    const gate = await folderUsable(db, me, id);
    if (!gate.ok) return Response.json({ error: `a subfolder is outside your department — move refused`, code: "forbidden" }, { status: 403 });
  }
  const { error } = await db.from("folders").update({ parent: p.data.parent }).eq("id", p.data.folder_id);
  if (error) return dbError("Couldn't move the folder.")(error);
  await logAudit({ actor: me.id, actor_name: me.username, action: "move", req, detail: { folder: p.data.folder_id, parent: p.data.parent } });
  return Response.json({ ok: true, id: p.data.folder_id });
}
