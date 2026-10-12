export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { bucketFor } from "@/lib/storage";
import { driveCtxFor, getAccounts, driveGoneReason, driveBlockedResponse } from "@/lib/drive-accounts";
import { canTouch, folderUsable, googleInScope, bustScopeCache, isBinned, binnedResponse } from "@/lib/visibility";
import { parseJson } from "@/lib/http";

const Body = z.object({
  file_id: z.string().uuid(),
  folder: z.string().uuid().nullable().optional(),
  // Google-side parent override (Drive id): pasting inside a drive view lands
  // the copy in THAT folder instead of wherever Drive feels like. Validated
  // against the source account's scope, like uploads.
  google_parent: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/).nullable().optional()
});

// Copy = new index row, bytes duplicated. Storage files: server-side object copy.
// Google files: drive.files.copy. The copy lands in `folder` (or the source folder),
// and on the Drive side next to the source (or under `google_parent`).
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  const db = adminClient();
  const { data: src } = await db.from("file_index")
    .select("id,name,mime,size,hash,storage_path,storage_bucket,google_file_id,google_parent_id,drive_account_id,backends,folder,owner").eq("id", p.data.file_id).maybeSingle();
  if (!src) return Response.json({ error: "file not found" }, { status: 404 });
  // Read the source only from your own / department space…
  const gate = await canTouch(db, me, src as { id: string; owner: string; folder: string | null });
  if (!gate.ok) return Response.json({ error: gate.reason ?? "not allowed" }, { status: 403 });
  // Scope: no cloning bytes out of a tree the workspace hides.
  const srcRow = src as { google_file_id?: string | null; drive_account_id?: string | null };
  if (srcRow.google_file_id) {
    if (!(await googleInScope(db, await getAccounts(), srcRow.drive_account_id, srcRow.google_file_id))) {
      return Response.json({ error: "outside this drive's shared scope" }, { status: 403 });
    }
  }
  const folder = p.data.folder !== undefined ? p.data.folder : src.folder;
  // …and land the copy somewhere you're allowed to write.
  if (folder) {
    const dst = await folderUsable(db, me, folder);
    if (!dst.ok) return Response.json({ error: dst.reason ?? "not allowed" }, { status: 403 });
  }
  // Trashed sources can't be cloned back to life — restore first.
  if (await isBinned(db, p.data.file_id)) return binnedResponse();
  // A copy writes through the source's drive account: if that drive is gone,
  // disabled, or legacy-unpinned, refuse BEFORE duplicating any bytes.
  // Fresh check, not cache — and it covers null pins (pending_relink), not
  // just pinned ones.
  if (srcRow.google_file_id) {
    const block = await driveGoneReason(srcRow.drive_account_id);
    if (block) return driveBlockedResponse(block);
  }
  const copyName = `Copy of ${src.name}`;
  const srcFull = src as { storage_bucket?: string | null; drive_account_id?: string | null; google_parent_id?: string | null };
  // Drive-side destination: explicit override wins, else the source's own
  // parent (copy lands next to the original — never My Drive root by accident).
  const driveParent: string | null = p.data.google_parent ?? srcFull.google_parent_id ?? null;
  if (p.data.google_parent && srcRow.drive_account_id) {
    const accs = await getAccounts();
    const scopeRoot = accs.find((a) => a.id === srcRow.drive_account_id)?.root_id ?? null;
    if (scopeRoot && p.data.google_parent !== scopeRoot) {
      if (!(await googleInScope(db, accs, srcRow.drive_account_id, p.data.google_parent))) {
        return Response.json({ error: "destination folder is outside this drive's shared scope" }, { status: 403 });
      }
    }
  }
  let storage_path: string | null = null;
  let google_file_id: string | null = null;
  let google_parent_id: string | null = null;
  const backends: string[] = [];
  // Order: Google FIRST, then Storage. A Storage-first order orphans the
  // staged object when the Google leg fails (nothing references it, nothing
  // deletes it). If the Storage leg fails after Google succeeded, the fresh
  // Google copy is removed again — no half-copies on either side.
  const dropStagedStorage = async () => {
    if (storage_path) {
      try { await db.storage.from(bucketFor(src)).remove([storage_path]); } catch { /* ignore */ }
      storage_path = null;
    }
  };
  const dropStagedGoogle = async () => {
    if (google_file_id) {
      try {
        const rctx = await driveCtxFor((src as { drive_account_id?: string | null }).drive_account_id);
        if (rctx?.drive) await rctx.drive.files.delete({ fileId: google_file_id, supportsAllDrives: true });
      } catch { /* ignore */ }
      google_file_id = null;
    }
  };
  try {
    if (src.google_file_id) {
      const ctx = await driveCtxFor((src as { drive_account_id?: string | null }).drive_account_id);
      const g = ctx?.drive;
      if (!g) throw new Error("google not configured");
      // drive.files.copy mints a SEPARATE Drive file id — never a second
      // reference to the source bytes. Verified below (google_file_id set
      // only from the copy response, and must differ from the source).
      const cp = await g.files.copy({ fileId: src.google_file_id, supportsAllDrives: true, fields: "id",
        ...(driveParent ? { requestBody: { parents: [driveParent] } } : {}) });
      google_file_id = cp.data.id ?? null;
      if (!google_file_id || google_file_id === src.google_file_id) {
        google_file_id = null;
        throw new Error("Google didn't return a separate copy — nothing was duplicated");
      }
      backends.push("google");
      google_parent_id = driveParent;
    }
    if (src.storage_path) {
      storage_path = `${me.id}/${Date.now()}-copy-${src.storage_path.split("/").pop()}`;
      const { error } = await db.storage.from(bucketFor(src)).copy(src.storage_path, storage_path);
      if (error) {
        await dropStagedGoogle();
        throw new Error(error.message);
      }
      backends.push("local");
    }
  } catch (e) {
    await dropStagedStorage();
    return Response.json({ error: e instanceof Error ? e.message : "copy failed", code: "google_failed" }, { status: 500 });
  }
  const { data, error } = await db.from("file_index").insert({
    name: copyName, mime: src.mime, size: src.size, hash: src.hash,
    backends: backends.length ? backends : src.backends,
    owner: me.id, folder, storage_path, google_file_id, google_parent_id,
    storage_bucket: storage_path ? ((src as { storage_bucket?: string | null }).storage_bucket ?? null) : null,
    drive_account_id: (src as { drive_account_id?: string | null }).drive_account_id ?? null
  }).select("id").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (srcRow.drive_account_id) bustScopeCache(srcRow.drive_account_id);
  await logAudit({ actor: me.id, actor_name: me.username, action: "add", file_id: data.id, req, detail: { copy_of: src.id } });
  return Response.json({ ok: true, id: data.id, name: copyName });
}
