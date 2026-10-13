export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { bucketFor } from "@/lib/storage";
import { driveCtxFor, getAccounts, driveGoneReason, driveBlockedResponse } from "@/lib/drive-accounts";
import type { DriveLike } from "@/lib/google-drive";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canTouch, folderUsable, googleInScope, bustScopeCache, isBinned, binnedResponse, googlePinOf } from "@/lib/visibility";
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
// Google FOLDERS copy recursively: the folder plus every indexed descendant
// duplicates (Drive files.copy never copies children by itself), nested copies
// re-parenting onto the duplicated folders so Drive and index agree.
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
  const gate = await canTouch(db, me, src as { id: string; owner: string; folder: string | null }, googlePinOf(src));
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
  // No pasting a folder inside itself or its own descendants (copies are new
  // rows, so this isn't a cycle — it's just never what anyone means).
  // Checked on the INDEX ancestry (bounded walk, same account).
  if (src.mime === "application/vnd.google-apps.folder" && srcRow.google_file_id && driveParent) {
    let cur: string | null = driveParent;
    const seen = new Set<string>();
    for (let i = 0; i < 25 && cur && !seen.has(cur); i++) {
      if (cur === srcRow.google_file_id) {
        return Response.json({ error: "can't paste a folder inside itself or its own subfolder", code: "self_descendant" }, { status: 400 });
      }
      seen.add(cur);
      const got = (await db.from("file_index").select("google_parent_id").eq("google_file_id", cur).eq("drive_account_id", srcRow.drive_account_id).maybeSingle()) as unknown as { data: { google_parent_id?: string | null } | null };
      cur = got.data?.google_parent_id ?? null;
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
  // Google folder: recurse the indexed subtree (same account only). Each
  // descendant duplicates next to its original; nested copies re-parent onto
  // the duplicated folders. Validated up front, executed with rollback — a
  // failure removes every copy made so far, Drive-side included.
  let nested = 0;
  let skippedBinned = 0;
  if (src.mime === "application/vnd.google-apps.folder" && google_file_id && srcRow.google_file_id && srcRow.drive_account_id) {
    const ctx = await driveCtxFor(srcRow.drive_account_id);
    const g = ctx?.drive;
    if (!g) {
      await dropStagedGoogle();
      await dropStagedStorage();
      await db.from("file_index").delete().eq("id", data.id);
      return driveBlockedResponse({ error: "chosen drive is disabled — re-enable it in Storage or pick another drive", code: "drive_disabled", status: 410 });
    }
    const rec = await copyDriveSubtree(db, me, g, {
      accountId: srcRow.drive_account_id,
      srcGoogleId: srcRow.google_file_id,
      newParentGoogleId: google_file_id,
    });
    if ("error" in rec) {
      await dropStagedGoogle();
      await dropStagedStorage();
      await db.from("file_index").delete().eq("id", data.id);
      return Response.json({ error: rec.error, code: "copy_failed" }, { status: 502 });
    }
    nested = rec.copied;
    skippedBinned = rec.skippedBinned;
  }
  // (Single-file copies keep the long-standing behavior: no tag/version
  // carry-over. Folder-subtree copies duplicate tags + versions per row so
  // the duplicate is complete — see copyDriveSubtree.)
  if (srcRow.drive_account_id) bustScopeCache(srcRow.drive_account_id);
  await logAudit({ actor: me.id, actor_name: me.username, action: "add", file_id: data.id, req, detail: { copy_of: src.id, nested, skipped_binned: skippedBinned } });
  return Response.json({ ok: true, id: data.id, name: copyName, nested });
}

// Recursively duplicate one Drive folder's indexed subtree (same account).
// Children validate (per-item auth, scope, bin state) BEFORE anything is
// created; creation failures roll back every copy made in this call, so a
// failed folder paste never leaves a partial tree.
async function copyDriveSubtree(
  db: SupabaseClient,
  me: { id: string; role: string; department_tag: string | null },
  g: DriveLike,
  opts: { accountId: string; srcGoogleId: string; newParentGoogleId: string }
): Promise<{ copied: number; skippedBinned: number } | { error: string }> {
  const { canTouch, googleInScope, googlePinOf, isBinned } = await import("@/lib/visibility");
  const { getAccounts } = await import("@/lib/drive-accounts");
  const { bucketFor } = await import("@/lib/storage");
  type Child = { id: string; name: string; mime: string; size: number; hash: string | null; storage_path: string | null; storage_bucket: string | null; google_file_id: string; google_parent_id: string | null; backends: string[]; owner: string; folder: string | null };
  if (!g) return { error: "google not configured" };
  // Collect the whole subtree first (BFS, parents before children).
  const levels: Child[] = [];
  const queue: string[] = [opts.srcGoogleId];
  const seen = new Set<string>([opts.srcGoogleId]);
  for (let i = 0; i < queue.length && i < 50 && levels.length < 1000; i++) {
    const { data, error } = await db.from("file_index")
      .select("id,name,mime,size,hash,storage_path,storage_bucket,google_file_id,google_parent_id,backends,owner,folder")
      .eq("google_parent_id", queue[i]).eq("drive_account_id", opts.accountId);
    if (error) return { error: error.message };
    for (const child of (data ?? []) as Child[]) {
      levels.push(child);
      if (child.mime === "application/vnd.google-apps.folder" && !seen.has(child.google_file_id)) {
        seen.add(child.google_file_id);
        queue.push(child.google_file_id);
      }
    }
  }
  const created: { indexId: string; googleId: string; storage?: { bucket: string; path: string } }[] = [];
  const rollback = async () => {
    for (const c of created.reverse()) {
      try { await db.from("file_index").delete().eq("id", c.indexId); } catch { /* ignore */ }
      try { await g.files.delete({ fileId: c.googleId, supportsAllDrives: true }); } catch { /* ignore */ }
      if (c.storage) {
        try { await db.storage.from(c.storage.bucket).remove([c.storage.path]); } catch { /* ignore */ }
      }
    }
  };
  // Validate everything up front: binned children are skipped (counted, never
  // cloned back to life); auth/scope failures refuse the whole paste.
  const accs = await getAccounts();
  let skippedBinned = 0;
  const todo: Child[] = [];
  for (const child of levels) {
    if (await isBinned(db, child.id)) { skippedBinned++; continue; }
    const gate = await canTouch(db, me, { id: child.id, owner: child.owner, folder: child.folder }, googlePinOf(child));
    if (!gate.ok) { await rollback(); return { error: gate.reason ?? "not allowed" }; }
    if (!(await googleInScope(db, accs, opts.accountId, child.google_file_id))) {
      await rollback();
      return { error: "a file inside is outside this drive's shared scope — copy refused" };
    }
    todo.push(child);
  }
  // Execute in BFS order so each folder copy exists before its children
  // re-parent onto it.
  const parentMap = new Map<string, string>([[opts.srcGoogleId, opts.newParentGoogleId]]);
  for (const child of todo) {
    const destParent = parentMap.get(child.google_parent_id ?? "") ?? child.google_parent_id;
    try {
      let storage_path: string | null = null;
      let storageRec: { bucket: string; path: string } | undefined;
      const backends: string[] = [];
      if (child.storage_path) {
        storage_path = `${me.id}/${Date.now()}-copy-${child.storage_path.split("/").pop()}`;
        const { error } = await db.storage.from(bucketFor(child)).copy(child.storage_path, storage_path);
        if (error) throw new Error(error.message);
        storageRec = { bucket: bucketFor(child), path: storage_path };
        backends.push("local");
      }
      const cp = await g.files.copy({
        fileId: child.google_file_id, supportsAllDrives: true, fields: "id",
        ...(destParent ? { requestBody: { parents: [destParent] } } : {}),
      });
      const newGoogleId = cp.data.id ?? null;
      if (!newGoogleId || newGoogleId === child.google_file_id) throw new Error("Google didn't return a separate copy");
      backends.push("google");
      const { data: ins, error } = await db.from("file_index").insert({
        name: child.name, mime: child.mime, size: child.size, hash: child.hash,
        backends, owner: me.id, folder: null,
        storage_path, storage_bucket: storage_path ? child.storage_bucket : null,
        google_file_id: newGoogleId, google_parent_id: destParent ?? child.google_parent_id,
        drive_account_id: opts.accountId,
      }).select("id").single();
      if (error || !ins) throw new Error(error?.message ?? "couldn't duplicate the files");
      const newId = (ins as { id: string }).id;
      if (child.mime === "application/vnd.google-apps.folder") parentMap.set(child.google_file_id, newGoogleId);
      created.push({ indexId: newId, googleId: newGoogleId, storage: storageRec });
      const { data: ftags } = await db.from("file_tags").select("tag_id").eq("file_id", child.id);
      for (const t of (ftags ?? []) as { tag_id: string }[]) {
        const { error: tErr } = await db.from("file_tags").insert({ file_id: newId, tag_id: t.tag_id });
        if (tErr) throw new Error(tErr.message);
      }
      const { data: vers } = await db.from("versions").select("v,hash,actor").eq("file_id", child.id).order("v");
      for (const v of (vers ?? []) as { v: number; hash: string; actor: string }[]) {
        const { error: vErr } = await db.from("versions").insert({ file_id: newId, v: v.v, hash: v.hash, actor: v.actor });
        if (vErr) throw new Error(vErr.message);
      }
    } catch (e) {
      await rollback();
      return { error: e instanceof Error ? e.message : "copy failed" };
    }
  }
  return { copied: created.length, skippedBinned };
}
