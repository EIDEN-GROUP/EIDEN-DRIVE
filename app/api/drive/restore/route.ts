export const dynamic = "force-dynamic";

import { z } from "zod";
import { createClient } from "@/lib/supabase-server";
import { adminClient } from "@/lib/supabase-admin";
import { restoreDriveFile, trashDriveFile, type DriveLike } from "@/lib/google-drive";
import { driveCtxFor, driveGoneReason, driveBlockedResponse } from "@/lib/drive-accounts";
import { logAudit } from "@/lib/audit";
import { getProfile } from "@/lib/roles";
import { googleDescendants, googleInScope, canTouch, googlePinOf, folderUsable, accessContext } from "@/lib/visibility";
import { getAccounts } from "@/lib/drive-accounts";
import { parseJson } from "@/lib/http";

const Body = z.object({
  file_id: z.string().uuid().optional(),
  folder_id: z.string().uuid().optional(),
}).refine((v) => (v.file_id ? !v.folder_id : !!v.folder_id), { message: "pass exactly one of file_id, folder_id" });

interface Me { id: string; username: string; role: string; department_tag: string | null }

// Restore from the Recovery Bin. Members may restore ELIGIBLE items (files
// and folders); permanent deletion stays manager/admin-only (purge route).
// The role gate alone is never the boundary: every file checks ownership /
// department / scope, every folder checks membership — a guessed UUID restores
// nothing.
export async function POST(req: Request) {
  const p0 = await getProfile();
  if (!p0) return Response.json({ error: "unauthorized" }, { status: 401 });
  const me: Me = { id: p0.id, username: p0.username, role: p0.role, department_tag: p0.department_tag };
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  if (p.data.folder_id) return restoreFolder(req, me, p.data.folder_id);
  return restoreFile(req, me, p.data.file_id as string);
}

async function restoreFile(req: Request, me: Me, file_id: string) {
  const supa = createClient();
  // Restoring something that isn't in the bin is a no-op that still audits —
  // refuse so "restore" always means something.
  const adb = adminClient();
  const { data: inBin } = await adb.from("recovery_bin").select("file_id").eq("file_id", file_id).maybeSingle();
  if (!inBin) return Response.json({ error: "file is not in the Recovery Bin", code: "not_binned" }, { status: 409 });
  const { data: f } = await supa.from("file_index").select("id,mime,owner,folder,google_file_id,google_parent_id,drive_account_id").eq("id", file_id).maybeSingle();
  if (!f) return Response.json({ error: "file not found", code: "not_found" }, { status: 404 });
  const fr = f as { id: string; owner: string; folder: string | null; google_file_id?: string | null; google_parent_id?: string | null; drive_account_id?: string | null };
  // Per-item authorization (members included): ownership, department-tag
  // inheritance (incl. Drive ancestry), scope. Managers bypass via canTouch.
  const db = adminClient();
  const gate = await canTouch(db, me, { id: fr.id, owner: fr.owner, folder: fr.folder }, googlePinOf(fr));
  if (!gate.ok) return Response.json({ error: gate.reason ?? "not allowed", code: "forbidden" }, { status: 403 });
  // Dead drives refuse first (410/404 with the exact reason) — scope verdicts
  // on an unreachable drive would only mislead ("out of scope" when the drive
  // is really just disabled).
  if (fr?.google_file_id) {
    const pre = await driveGoneReason(fr.drive_account_id);
    if (pre) return driveBlockedResponse(pre);
  }
  // Scope binds every role including managers: restoring an out-of-scope row
  // would unhide Drive content the workspace deliberately doesn't show.
  if (fr?.google_file_id && fr?.drive_account_id) {
    if (!(await googleInScope(db, await getAccounts(), fr.drive_account_id, fr.google_file_id))) {
      return Response.json({ error: "outside this drive's shared scope", code: "out_of_scope" }, { status: 403 });
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
      const fr2 = f as { mime?: string; drive_account_id?: string | null; google_file_id?: string | null };
      if (fr2.mime === "application/vnd.google-apps.folder" && fr2.drive_account_id && fr2.google_file_id) {
        const kids = await googleDescendants(adminClient(), fr2.drive_account_id, String(fr2.google_file_id));
        for (let i = 0; i < kids.length; i += 200) {
          await adminClient().from("recovery_bin").delete().in("file_id", kids.slice(i, i + 200));
        }
      }
    }
    catch (e) { return Response.json({ error: `Google restore failed: ${e instanceof Error ? e.message : "unknown"}`, code: "google_failed" }, { status: 502 }); }
  }
  const { error } = await adminClient().from("recovery_bin").delete().eq("file_id", file_id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "restore", file_id, req });
  return Response.json({ ok: true });
}

async function restoreFolder(req: Request, me: Me, folder_id: string) {
  const db = adminClient();
  const isMgr = me.role === "admin" || me.role === "manager";
  // Must actually be binned — restoring a live folder is a no-op refusal.
  // (A missing folder_bin table = migration 0020 not applied: fail loudly,
  // never pretend the folder isn't binned.)
  const { data: binRow, error: binErr } = await db.from("folder_bin").select("folder_id").eq("folder_id", folder_id).maybeSingle();
  if (binErr && /does not exist|could not find|schema cache/i.test(binErr.message)) {
    return Response.json({ error: "folder recovery isn't set up yet — apply migration 0020", code: "migration_missing" }, { status: 500 });
  }
  if (!binRow) return Response.json({ error: "folder is not in the Recovery Bin", code: "not_binned" }, { status: 409 });
  const { data: f } = await db.from("folders").select("id,name,parent,dept,classification").eq("id", folder_id).maybeSingle();
  if (!f) {
    // Folder row destroyed (pre-migration deletes): drop the stale marker.
    await db.from("folder_bin").delete().eq("folder_id", folder_id);
    return Response.json({ error: "that folder no longer exists — its marker was cleared", code: "folder_gone" }, { status: 404 });
  }
  const folder = f as { id: string; name: string; parent: string | null; dept: string | null; classification: string | null };
  // Membership, ignoring the binned-state subtraction (the target IS binned —
  // that's why we're here): prove it from pre-bin visibility instead.
  const ctx = await accessContext(db, me, { includeBinned: true });
  const outsideDept = ctx.folders !== null && !ctx.folders.has(folder_id);
  if (!isMgr && outsideDept) {
    return Response.json({ error: "this folder belongs to another department", code: "forbidden" }, { status: 403 });
  }
  // Original parent: gone → re-home to root (with a note); binned → restore
  // the parent first; live but unusable → refuse.
  let note: string | undefined;
  if (folder.parent) {
    const { data: par } = await db.from("folders").select("id").eq("id", folder.parent).maybeSingle();
    if (!par) {
      await db.from("folders").update({ parent: null }).eq("id", folder_id);
      folder.parent = null;
      note = "the original parent folder no longer exists — restored to the top level";
    } else {
      const { data: parBin } = await db.from("folder_bin").select("folder_id").eq("folder_id", folder.parent).maybeSingle();
      if (parBin) {
        return Response.json({ error: "restore the parent folder first, then this one", code: "parent_binned" }, { status: 409 });
      }
      if (!isMgr) {
        const dst = await folderUsable(db, me, folder.parent);
        if (!dst.ok) return Response.json({ error: dst.reason ?? "not allowed", code: "forbidden" }, { status: 403 });
      }
    }
  }

  // Subtree (folders + files). Files keep their folder FKs — hierarchy is
  // preserved by construction, never re-homed, never duplicated.
  const order: string[] = [folder_id];
  const seen = new Set<string>(order);
  for (let i = 0, frontier = [folder_id]; frontier.length && i < 50; i++) {
    const next: string[] = [];
    for (let j = 0; j < frontier.length; j += 200) {
      const { data: kids, error } = await db.from("folders").select("id").in("parent", frontier.slice(j, j + 200));
      if (error) return Response.json({ error: error.message }, { status: 500 });
      for (const k of (kids ?? []) as { id: string }[]) {
        if (!seen.has(k.id)) { seen.add(k.id); next.push(k.id); }
      }
    }
    frontier = next;
    order.push(...frontier);
  }
  const files: { id: string; owner: string; folder: string | null; google_file_id: string | null; google_parent_id: string | null; drive_account_id: string | null }[] = [];
  for (let i = 0; i < order.length; i += 200) {
    const { data, error } = await db.from("file_index").select("id,owner,folder,google_file_id,google_parent_id,drive_account_id").in("folder", order.slice(i, i + 200));
    if (error) return Response.json({ error: error.message }, { status: 500 });
    files.push(...((data ?? []) as typeof files));
  }
  const { data: binnedRows } = await db.from("recovery_bin").select("file_id").in("file_id", files.map((x) => x.id));
  const binned = new Set(((binnedRows ?? []) as { file_id: string }[]).map((b) => b.file_id));
  const todo = files.filter((x) => binned.has(x.id));

  // Per-file eligibility for non-managers (conflicting tags, other owners
  // outside the subtree grant): ineligible files stay binned and are counted,
  // never silently restored, never blocking the rest.
  let skipped = 0;
  const eligible = [];
  for (const x of todo) {
    if (isMgr) { eligible.push(x); continue; }
    // Pre-bin membership (the folders are binned — that is why we're here).
    const gate = await canTouch(db, me, { id: x.id, owner: x.owner, folder: x.folder }, googlePinOf(x), { includeBinned: true });
    if (!gate.ok) { skipped++; continue; }
    eligible.push(x);
  }

  // Google restores FIRST (most likely to fail) with rollback: an abort
  // re-trashes whatever this call untrashed, so Drive never half-opens.
  const untrashed: { id: string; drive: DriveLike }[] = [];
  const googleRows = eligible.filter((x) => x.google_file_id);
  for (const x of googleRows) {
    const pin = x.drive_account_id;
    const block = await driveGoneReason(pin);
    if (block) {
      await rollbackUntrash(untrashed);
      return driveBlockedResponse(block);
    }
    try {
      const ctx = await driveCtxFor(pin);
      if (!ctx?.drive) {
        await rollbackUntrash(untrashed);
        return driveBlockedResponse({ error: "chosen drive is disabled — re-enable it in Storage or pick another drive", code: "drive_disabled", status: 410 });
      }
      if (x.google_parent_id) {
        try {
          await ctx.drive.files.get({ fileId: x.google_parent_id, fields: "id,trashed", supportsAllDrives: true });
        } catch (e) {
          const m = e instanceof Error ? e.message : "";
          if (/not.?found|404/i.test(m)) {
            await rollbackUntrash(untrashed);
            return Response.json({ error: `a Drive folder inside is gone — restore it in Drive first; nothing was restored`, code: "parent_gone" }, { status: 409 });
          }
          throw e;
        }
      }
      if (!(await googleInScope(db, await getAccounts(), x.drive_account_id, x.google_file_id))) {
        await rollbackUntrash(untrashed);
        return Response.json({ error: "outside this drive's shared scope", code: "out_of_scope" }, { status: 403 });
      }
      await restoreDriveFile(String(x.google_file_id), ctx.drive);
      untrashed.push({ id: String(x.google_file_id), drive: ctx.drive });
    } catch (e) {
      await rollbackUntrash(untrashed);
      return Response.json({ error: `Google restore failed: ${e instanceof Error ? e.message : "unknown"} (nothing was restored)`, code: "google_failed" }, { status: 502 });
    }
  }

  // Index unbins: folders (whole subtree) + eligible files still binned.
  for (let i = 0; i < order.length; i += 200) {
    const { error } = await db.from("folder_bin").delete().in("folder_id", order.slice(i, i + 200));
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }
  const eligibleIds = eligible.map((x) => x.id);
  for (let i = 0; i < eligibleIds.length; i += 200) {
    const { error } = await db.from("recovery_bin").delete().in("file_id", eligibleIds.slice(i, i + 200));
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }
  await logAudit({ actor: me.id, actor_name: me.username, action: "restore", req, detail: { folder: folder_id, name: folder.name, folders: order.length, files: eligibleIds.length, skipped } });
  return Response.json({ ok: true, folders: order.length, files: eligibleIds.length, skipped, ...(note ? { note } : {}) });
}

async function rollbackUntrash(untrashed: { id: string; drive: DriveLike }[]) {
  for (const u of untrashed) {
    try { await trashDriveFile(u.id, u.drive); }
    catch (e) { console.warn(`[restore-rollback] couldn't re-trash ${u.id}: ${e instanceof Error ? e.message : e}`); }
  }
}
