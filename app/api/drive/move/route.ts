export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { driveCtxFor, getAccounts, driveGoneReason, driveBlockedResponse, requireActiveAccount } from "@/lib/drive-accounts";
import { canTouch, folderUsable, googleInScope, bustScopeCache, isBinned, binnedResponse, googlePinOf } from "@/lib/visibility";
import { parseJson } from "@/lib/http";

const Body = z.object({
  file_id: z.string().uuid(),
  // Local workspace destination (null = Workspace root). Applies to every row.
  folder: z.string().uuid().nullable().optional(),
  // Google-side destination folder (Drive id): true move in Drive via
  // addParents/removeParents. Applies when the row has a google pin.
  google_parent: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/).nullable().optional(),
});

// Move = relocate, no bytes copied. Local rows change `folder`; google-pinned
// rows additionally move inside Drive (addParents/removeParents) so both sides
// agree. Works on Workspace rows AND drive rows — the destination decides.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  if (p.data.folder === undefined && p.data.google_parent === undefined) {
    return Response.json({ error: "nothing to move to — pass folder and/or google_parent" }, { status: 400 });
  }
  const db = adminClient();
  const { data: src } = await db.from("file_index")
    .select("id,name,mime,folder,owner,google_file_id,google_parent_id,drive_account_id").eq("id", p.data.file_id).maybeSingle();
  if (!src) return Response.json({ error: "file not found" }, { status: 404 });
  const row = src as { id: string; name: string; mime: string; folder: string | null; owner: string; google_file_id: string | null; google_parent_id: string | null; drive_account_id: string | null };
  const gate = await canTouch(db, me, row, googlePinOf(row));
  if (!gate.ok) return Response.json({ error: gate.reason ?? "not allowed" }, { status: 403 });
  // Trashed rows move only via restore — never drag them back to life.
  if (await isBinned(db, p.data.file_id)) return binnedResponse();
  // Local destination must be writable…
  const folder = p.data.folder !== undefined ? p.data.folder : row.folder;
  if (folder) {
    const dst = await folderUsable(db, me, folder);
    if (!dst.ok) return Response.json({ error: dst.reason ?? "not allowed" }, { status: 403 });
  }
  // …and the google side must stay inside its scope.
  let newParent: string | null = row.google_parent_id;
  if (p.data.google_parent !== undefined) newParent = p.data.google_parent;
  if (row.google_file_id) {
    const accs = await getAccounts();
    if (!(await googleInScope(db, accs, row.drive_account_id, row.google_file_id))) {
      return Response.json({ error: "outside this drive's shared scope" }, { status: 403 });
    }
    if (newParent && row.drive_account_id) {
      const scopeRoot = accs.find((a) => a.id === row.drive_account_id)?.root_id ?? null;
      if (scopeRoot && newParent !== scopeRoot) {
        if (!(await googleInScope(db, accs, row.drive_account_id, newParent))) {
          return Response.json({ error: "destination folder is outside this drive's shared scope" }, { status: 403 });
        }
      }
      // The destination must be a real folder in the SAME account, not binned,
      // and already indexed (unindexed ids can't be scope-checked). Moving to
      // My Drive root (null) is refused: the row would go placeless-but-visible
      // while Drive keeps its old parents — index and reality would diverge.
      // A folder is never its own destination (nor its descendant's): Drive
      // would refuse the cycle, but the index must never get there first.
      if (newParent === row.google_file_id) {
        return Response.json({ error: "can't move a folder inside itself", code: "self_descendant" }, { status: 400 });
      }
      if (newParent && row.mime === "application/vnd.google-apps.folder") {
        let cur: string | null = newParent;
        const seen = new Set<string>();
        for (let i = 0; i < 25 && cur && !seen.has(cur); i++) {
          seen.add(cur);
          const got = (await db.from("file_index").select("google_parent_id").eq("google_file_id", cur).eq("drive_account_id", row.drive_account_id).maybeSingle()) as unknown as { data: { google_parent_id?: string | null } | null };
          cur = got.data?.google_parent_id ?? null;
          if (cur === row.google_file_id) {
            return Response.json({ error: "can't move a folder inside one of its own subfolders", code: "self_descendant" }, { status: 400 });
          }
        }
      }
      if (newParent !== scopeRoot) {
        const { data: pf } = await db.from("file_index")
          .select("id,mime,drive_account_id").eq("google_file_id", newParent).eq("drive_account_id", row.drive_account_id).maybeSingle();
        const prow = pf as { id: string; mime: string; drive_account_id: string } | null;
        if (!prow) return Response.json({ error: "destination folder isn't indexed — open it in the drive tree (Sync) first" }, { status: 409 });
        if (prow.mime !== "application/vnd.google-apps.folder") {
          return Response.json({ error: "destination is a file, not a folder" }, { status: 400 });
        }
        const { data: pb } = await db.from("recovery_bin").select("file_id").eq("file_id", prow.id).maybeSingle();
        if (pb) return Response.json({ error: "destination folder is in the Recovery Bin" }, { status: 409 });
      }
    } else if (row.google_file_id && p.data.google_parent !== undefined && !newParent) {
      return Response.json({ error: "moving out of every folder isn't allowed — pick a destination inside the drive" }, { status: 400 });
    }
  } else if (newParent) {
    return Response.json({ error: "this file lives in Supabase only — pass folder, not google_parent" }, { status: 400 });
  }
  // Drive-side move first (most likely to fail): remove every current parent,
  // add the new one. Drive refuses to orphan, so old parents resolve live.
  // The source account is revalidated fresh here (not from the cached list
  // above): disabled/deleted mid-flight refuses instead of moving bytes on a
  // dead drive. The destination folder was proven indexed under this same
  // account above — cross-drive moves are impossible by construction.
  if (row.google_file_id && p.data.google_parent !== undefined) {
    const block = await driveGoneReason(row.drive_account_id);
    if (block) return driveBlockedResponse(block);
    // Null pins fall through only when the check is off (legacy env mode);
    // pinned accounts are revalidated fresh regardless of the list cache.
    if (row.drive_account_id) {
      const fresh = await requireActiveAccount(row.drive_account_id);
      if ("error" in fresh) return driveBlockedResponse(fresh);
    }
    try {
      const ctx = await driveCtxFor(row.drive_account_id);
      const g = ctx?.drive;
      if (!g) return driveBlockedResponse({ error: "chosen drive is disabled — re-enable it in Storage or pick another drive", code: "drive_disabled", status: 410 });
      const meta = await g.files.get({ fileId: row.google_file_id, fields: "parents", supportsAllDrives: true });
      const oldParents = ((meta.data.parents ?? []) as string[]).join(",");
      await g.files.update({
        fileId: row.google_file_id, supportsAllDrives: true,
        ...(newParent ? { addParents: newParent } : {}),
        ...(oldParents ? { removeParents: oldParents } : {}),
        fields: "id,parents",
      });
    } catch (e) {
      return Response.json({ error: `Google move failed: ${e instanceof Error ? e.message : "unknown"} (nothing was moved)` }, { status: 502 });
    }
  }
  const patch: Record<string, unknown> = {};
  if (p.data.folder !== undefined) patch.folder = folder;
  if (row.google_file_id && p.data.google_parent !== undefined) patch.google_parent_id = newParent;
  if (Object.keys(patch).length) {
    const { error } = await db.from("file_index").update(patch).eq("id", row.id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }
  if (row.drive_account_id) bustScopeCache(row.drive_account_id);
  await logAudit({ actor: me.id, actor_name: me.username, action: "move", file_id: row.id, req, detail: { folder, google_parent: newParent } });
  return Response.json({ ok: true, id: row.id });
}
