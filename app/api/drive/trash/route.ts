export const dynamic = "force-dynamic";

import { z } from "zod";
import { createClient } from "@/lib/supabase-server";
import { adminClient } from "@/lib/supabase-admin";
import { trashDriveFile } from "@/lib/google-drive";
import { driveCtxFor } from "@/lib/drive-accounts";
import { logAudit } from "@/lib/audit";
import { getProfile, needsApproval } from "@/lib/roles";
import { canTouch } from "@/lib/visibility";
import { notify } from "@/lib/alerts";
import { parseJson } from "@/lib/http";

const Body = z.object({ file_id: z.string().uuid() });

// Safe-delete: members go to Recovery Bin (90d). Sensitive folders also need approval. DB first, then Google,
// so a Google failure can never leave a file trashed in Drive but missing from the Bin.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  const { file_id } = p.data;

  const supa = createClient();
  const { data: f, error: fe } = await supa.from("file_index").select("id,name,google_file_id,folder,drive_account_id,owner").eq("id", file_id).maybeSingle();
  if (fe) return Response.json({ error: fe.message }, { status: 500 });
  if (!f) return Response.json({ error: "file not found" }, { status: 404 });
  // Confinement: members trash only own / department-tagged items.
  const gate = await canTouch(adminClient(), me, f as { id: string; owner: string; folder: string | null });
  if (!gate.ok) return Response.json({ error: gate.reason ?? "not allowed" }, { status: 403 });

  let classification = "Internal";
  if (f.folder) {
    const { data: fol } = await supa.from("folders").select("classification").eq("id", f.folder).maybeSingle();
    classification = fol?.classification ?? "Internal";
  }

  // Mutations use the service role AFTER the checks above (reads stay on RLS).
  const db = adminClient();
  const { error: be } = await db.from("recovery_bin").upsert({ file_id, deleted_by: me.id });
  if (be) return Response.json({ error: `could not move to bin: ${be.message}` }, { status: 500 });

  if (f.google_file_id) {
    try {
      const ctx = await driveCtxFor((f as { drive_account_id?: string | null }).drive_account_id);
      await trashDriveFile(String(f.google_file_id), ctx?.drive ?? undefined);
    }
    catch (e) {
      await db.from("recovery_bin").delete().eq("file_id", file_id); // roll back so DB and Drive agree
      return Response.json({ error: `Google trash failed: ${e instanceof Error ? e.message : "unknown"}` }, { status: 502 });
    }
  }

  const needsOk = needsApproval(classification, "delete");
  if (needsOk) {
    await db.from("approvals").insert({ action: "delete", file_id, requester: me.id });
    await notify(null, "approval-pending", "Delete needs approval", `${me.username} requested delete of ${f.name}`);
  }
  await logAudit({ actor: me.id, actor_name: me.username, action: "trash", file_id, req, detail: { classification, approval: needsOk } });
  return Response.json({ ok: true, recovery_bin: true, purge_in_days: 90, approval_required: needsOk });
}
