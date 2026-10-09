export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { renameDriveFile } from "@/lib/google-drive";
import { driveCtxFor } from "@/lib/drive-accounts";
import { canTouch } from "@/lib/visibility";
import { parseJson } from "@/lib/http";

const Body = z.object({
  file_id: z.string().uuid(),
  name: z.string().trim().min(1).max(255).refine((n) => !n.includes("/"), { message: "no slashes in file names" })
});

// Members and up can rename (it's an edit, not a delete) — but only inside
// their own / department-tagged space. Google copy renamed too when present.
export async function PATCH(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  const db = adminClient();
  const { data: f } = await db.from("file_index").select("id,name,google_file_id,drive_account_id,owner,folder").eq("id", p.data.file_id).maybeSingle();
  if (!f) return Response.json({ error: "not found" }, { status: 404 });
  const gate = await canTouch(db, me, f as { id: string; owner: string; folder: string | null });
  if (!gate.ok) return Response.json({ error: gate.reason ?? "not allowed" }, { status: 403 });
  if (f.google_file_id) {
    try {
      const ctx = await driveCtxFor((f as { drive_account_id?: string | null }).drive_account_id);
      await renameDriveFile(String(f.google_file_id), p.data.name, ctx?.drive ?? undefined);
    }
    catch { return Response.json({ error: "Google rename failed — nothing changed" }, { status: 502 }); }
  }
  const { error } = await db.from("file_index").update({ name: p.data.name }).eq("id", p.data.file_id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "rename", file_id: p.data.file_id, req, detail: { from: f.name, to: p.data.name } });
  return Response.json({ ok: true });
}
