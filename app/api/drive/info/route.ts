export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { canTouch, accessContext, googlePinOf } from "@/lib/visibility";
import {
  latestFileAudit, latestVersionAttribution, latestFolderAttribution,
  googleAttribution, newest,
} from "@/lib/file-attribution";
import { rateLimited, clientIp } from "@/lib/rate";

const Query = z.object({
  file_id: z.string().uuid().nullish(),
  folder_id: z.string().uuid().nullish(),
});

// GET /api/drive/info?file_id= | ?folder_id= — "Modified by" attribution for
// Get Info. Access is rechecked server-side before ANY audit metadata is
// returned (missing and forbidden both read 404 — no existence oracle).
// modified_at + modified_by always describe the SAME event; nulls mean "not
// recorded" (the client renders the documented fallback, never a guess).
export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (rateLimited(`drive-info:${me.id}:${clientIp(req)}`, 60)) {
    return Response.json({ error: "slow down" }, { status: 429 });
  }
  const u = new URL(req.url);
  const p = Query.safeParse({ file_id: u.searchParams.get("file_id"), folder_id: u.searchParams.get("folder_id") });
  if (!p.success || (!p.data.file_id && !p.data.folder_id)) {
    return Response.json({ error: "file_id or folder_id required" }, { status: 400 });
  }
  const db = adminClient();

  if (p.data.file_id) {
    const { data: f } = await db.from("file_index")
      .select("id,owner,folder,google_file_id,drive_account_id").eq("id", p.data.file_id).maybeSingle();
    if (!f) return Response.json({ error: "not found" }, { status: 404 });
    const row = f as { id: string; owner: string | null; folder: string | null; google_file_id: string | null; drive_account_id: string | null };
    const gate = await canTouch(db, me, { id: row.id, owner: row.owner ?? "", folder: row.folder }, googlePinOf(row));
    if (!gate.ok) return Response.json({ error: "not found" }, { status: 404 });

    const audit = await latestFileAudit(db, row.id);
    const version = audit ? null : await latestVersionAttribution(db, row.id);
    let best = newest(audit, version);
    if (row.google_file_id && row.drive_account_id) {
      const ext = await googleAttribution(row.google_file_id, row.drive_account_id);
      best = newest(best, ext);
    }
    return Response.json({ ok: true, modified_at: best?.at ?? null, modified_by: best?.by ?? null });
  }

  const { data: fol } = await db.from("folders").select("id,name").eq("id", p.data.folder_id!).maybeSingle();
  if (!fol) return Response.json({ error: "not found" }, { status: 404 });
  const folder = fol as { id: string; name: string };
  const ctx = await accessContext(db, me);
  if (ctx.folders !== null && !ctx.folders.has(folder.id)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  let childIds: string[] = [];
  try {
    const { data: kids } = await db.from("file_index").select("id").eq("folder", folder.id).limit(500);
    childIds = ((kids ?? []) as { id: string }[]).map((k) => k.id);
  } catch { /* attribution degrades to folder ops only */ }
  const best = await latestFolderAttribution(db, folder.id, folder.name, childIds);
  return Response.json({ ok: true, modified_at: best?.at ?? null, modified_by: best?.by ?? null });
}
