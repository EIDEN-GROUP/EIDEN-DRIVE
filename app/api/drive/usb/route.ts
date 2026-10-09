export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { queueUsbUpload } from "@/lib/usb";
import { canTouch, googleInScope } from "@/lib/visibility";
import { getAccounts } from "@/lib/drive-accounts";
import { parseJson } from "@/lib/http";

const Body = z.object({ file_id: z.string().uuid() });

// Queue an office-USB copy of an existing Storage-backed file. Same async model
// as upload-time USB: Supabase stays the primary, the agent mirrors to the
// router USB share when it next checks in.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  const db = adminClient();
  const { data: f } = await db.from("file_index").select("id,name,size,storage_path,storage_bucket,google_file_id,drive_account_id,owner,folder").eq("id", p.data.file_id).maybeSingle();
  const file = f as { id: string; name: string; size: number; storage_path: string | null; storage_bucket: string | null; owner: string; folder: string | null } | null;
  if (!file) return Response.json({ error: "file not found" }, { status: 404 });
  if (!file.storage_path) return Response.json({ error: "only Supabase-hosted files can be copied to USB" }, { status: 400 });
  const gate = await canTouch(db, me, file);
  if (!gate.ok) return Response.json({ error: gate.reason ?? "not allowed" }, { status: 403 });
  // Scope: a USB stick is exfiltration — never copy bytes from a hidden tree.
  const usbRow = file as { google_file_id?: string | null; drive_account_id?: string | null };
  if (usbRow.google_file_id) {
    if (!(await googleInScope(db, await getAccounts(), usbRow.drive_account_id, usbRow.google_file_id))) {
      return Response.json({ error: "outside this drive's shared scope" }, { status: 403 });
    }
  }
  try {
    const { jobId } = await queueUsbUpload({ id: file.id, storage_path: file.storage_path, name: file.name, size: file.size ?? 0, owner: me.id, ownerName: me.username });
    await logAudit({ actor: me.id, actor_name: me.username, action: "add", file_id: file.id, req, detail: { usb_job: jobId } });
    return Response.json({ ok: true, jobId, note: "queued — the office agent copies it to USB on next check-in" });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "usb queue failed" }, { status: 500 });
  }
}
