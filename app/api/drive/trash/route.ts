import { z } from "zod";
import { createClient } from "@/lib/supabase-server";
import { trashDriveFile } from "@/lib/google-drive";
import { logAudit } from "@/lib/audit";
import { getProfile, needsApproval } from "@/lib/roles";
import { notify } from "@/lib/alerts";

const Body = z.object({ file_id: z.string().min(1) });

// Safe-delete: members go to Recovery Bin (90d). Sensitive folders need approval. Google trashed in parallel.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { file_id } = Body.parse(await req.json());
  const supa = createClient();
  const { data: f } = await supa.from("file_index").select("id,name,google_file_id,folder").eq("id", file_id).single();

  if (f?.google_file_id) await trashDriveFile(String(f.google_file_id));
  await supa.from("recovery_bin").upsert({ file_id, deleted_by: me.id });
  if (f && needsApproval("Contracts", "delete")) {
    await supa.from("approvals").insert({ action: "delete", file_id, requester: me.id });
    await notify(null, "approval-pending", "Delete needs approval", `${me.username} requested delete of ${f.name}`);
  }
  await logAudit({ actor: me.id, actor_name: me.username, action: "trash", file_id, req });
  return Response.json({ ok: true, recovery_bin: true, purge_in_days: 90 });
}
