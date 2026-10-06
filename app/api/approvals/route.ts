export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { restoreDriveFile } from "@/lib/google-drive";
import { parseJson } from "@/lib/http";

const Body = z.object({
  approval_id: z.string().uuid(),
  decision: z.enum(["approved", "denied"])
});

// Managers+: decide a pending delete approval. Approve = acknowledge (file stays in the
// Bin until purged/restored). Deny = the delete is rejected, so the file is restored.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "approve")) return Response.json({ error: "managers only" }, { status: 403 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  const db = adminClient();
  const { data: ap } = await db.from("approvals").select("id,file_id,requester,status").eq("id", p.data.approval_id).maybeSingle();
  if (!ap) return Response.json({ error: "not found" }, { status: 404 });
  if (ap.status !== "pending") return Response.json({ error: `already ${ap.status}` }, { status: 400 });

  if (p.data.decision === "denied" && ap.file_id) {
    const { data: f } = await db.from("file_index").select("google_file_id").eq("id", ap.file_id).maybeSingle();
    if (f?.google_file_id) {
      try { await restoreDriveFile(String(f.google_file_id)); }
      catch { return Response.json({ error: "Google restore failed" }, { status: 502 }); }
    }
    await db.from("recovery_bin").delete().eq("file_id", ap.file_id);
  }
  await db.from("approvals").update({ status: p.data.decision, approver: me.id }).eq("id", p.data.approval_id);
  await logAudit({ actor: me.id, actor_name: me.username, action: p.data.decision === "denied" ? "restore" : "edit", file_id: ap.file_id, req, detail: { approval: p.data.approval_id, decision: p.data.decision } });
  return Response.json({ ok: true });
}
