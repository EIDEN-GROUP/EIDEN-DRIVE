export const dynamic = "force-dynamic";

import { z } from "zod";
import { createClient } from "@/lib/supabase-server";
import { adminClient } from "@/lib/supabase-admin";
import { restoreDriveFile } from "@/lib/google-drive";
import { driveCtxFor, driveGoneReason, driveBlockedResponse } from "@/lib/drive-accounts";
import { logAudit } from "@/lib/audit";
import { getProfile, can } from "@/lib/roles";
import { googleDescendants, googleInScope } from "@/lib/visibility";
import { getAccounts } from "@/lib/drive-accounts";
import { parseJson } from "@/lib/http";

const Body = z.object({ file_id: z.string().uuid() });

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "restore")) return Response.json({ error: "managers only" }, { status: 403 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  const { file_id } = p.data;
  const supa = createClient();
  // Restoring something that isn't in the bin is a no-op that still audits —
  // refuse so "restore" always means something.
  const adb = adminClient();
  const { data: inBin } = await adb.from("recovery_bin").select("file_id").eq("file_id", file_id).maybeSingle();
  if (!inBin) return Response.json({ error: "file is not in the Recovery Bin" }, { status: 409 });
  const { data: f } = await supa.from("file_index").select("id,mime,google_file_id,google_parent_id,drive_account_id").eq("id", file_id).maybeSingle();
  const fr0 = f as { google_file_id?: string | null; drive_account_id?: string | null } | null;
  // Scope binds every role including managers: restoring an out-of-scope row
  // would unhide Drive content the workspace deliberately doesn't show.
  if (fr0?.google_file_id && fr0?.drive_account_id) {
    const db = adminClient();
    if (!(await googleInScope(db, await getAccounts(), fr0.drive_account_id, fr0.google_file_id))) {
      return Response.json({ error: "outside this drive's shared scope" }, { status: 403 });
    }
  }
  if (f?.google_file_id) {
    // Fail closed before touching Google (same rule as trash): a dead drive
    // refuses the restore instead of unhiding bytes via the wrong token.
    const pin = (f as { drive_account_id?: string | null }).drive_account_id;
    const block = await driveGoneReason(pin);
    if (block) return driveBlockedResponse(block);
    try {
      const ctx = await driveCtxFor(pin);
      if (!ctx?.drive) {
        return driveBlockedResponse({ error: "chosen drive is disabled — re-enable it in Storage or pick another drive", code: "drive_disabled", status: 410 });
      }
      // The original Drive parent must still exist live: restoring into a
      // deleted folder would orphan the file in Drive (visible nowhere).
      // Checked BEFORE untrashing so a refusal leaves Drive and index agreeing.
      const frp = f as { google_parent_id?: string | null };
      if (frp.google_parent_id) {
        try {
          await ctx.drive.files.get({ fileId: frp.google_parent_id, fields: "id,trashed", supportsAllDrives: true });
        } catch (e) {
          const m = e instanceof Error ? e.message : "";
          if (/not.?found|404/i.test(m)) {
            return Response.json({ error: "the original Drive folder is gone — move a live copy where it belongs instead; this entry stays in the Recovery Bin", code: "parent_gone" }, { status: 409 });
          }
          throw e;
        }
      }
      await restoreDriveFile(String(f.google_file_id), ctx.drive);
      // A restored Google folder unhides its whole subtree in Drive — clear
      // the bin rows trash put on every indexed descendant.
      const fr = f as { mime?: string; drive_account_id?: string | null; google_file_id?: string | null };
      if (fr.mime === "application/vnd.google-apps.folder" && fr.drive_account_id && fr.google_file_id) {
        const kids = await googleDescendants(adminClient(), fr.drive_account_id, String(fr.google_file_id));
        for (let i = 0; i < kids.length; i += 200) {
          await adminClient().from("recovery_bin").delete().in("file_id", kids.slice(i, i + 200));
        }
      }
    }
    catch (e) { return Response.json({ error: `Google restore failed: ${e instanceof Error ? e.message : "unknown"}` }, { status: 502 }); }
  }
  const { error } = await adminClient().from("recovery_bin").delete().eq("file_id", file_id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "restore", file_id, req });
  return Response.json({ ok: true });
}
