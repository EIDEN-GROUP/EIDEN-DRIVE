export const dynamic = "force-dynamic";

import { z } from "zod";
import { Readable } from "node:stream";
import { adminClient } from "@/lib/supabase-admin";
import { logAudit } from "@/lib/audit";
import { getProfile } from "@/lib/roles";
import { UPLOAD_BUCKET, PFP_BUCKET } from "@/lib/storage";
import { rootFor } from "@/lib/google-drive";
import { googleErrorMessage } from "@/lib/errors";
import { queueUsbUpload } from "@/lib/usb";
import { pickUploadAccount, clientFor } from "@/lib/drive-accounts";
import { notifyUpload } from "@/lib/upload-notify";
import { folderUsable } from "@/lib/visibility";
import { parseJson } from "@/lib/http";

// Metadata-only: bytes already went to Supabase Storage via a signed URL (or the agent staged them).
// Registers file_index + version + audit. storage_path must live under the caller's own prefix.
//
// Google mirror: unless drive_account is explicitly null, the server also pushes
// the bytes to a Google account with room (quota-checked BEFORE upload — full
// drives are skipped, never attempted). drive_account: uuid pins one drive,
// "auto"/omitted picks the roomiest, null keeps it local-only.
const Body = z.object({
  name: z.string().trim().min(1).max(255),
  mime: z.string().max(127).optional(),
  size: z.number().int().nonnegative().max(1024 ** 4).optional(),
  hash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  backends: z.array(z.enum(["google", "local", "backup"])).min(1).max(3).optional(),
  folder: z.string().uuid().nullable().optional(),
  storage_path: z.string().max(600).nullable().optional(),
  // Which bucket storage_path lives in (avatars register 'eiden-pfp').
  // Anything else is rejected: bytes must be where the index says they are.
  storage_bucket: z.enum(["eiden-uploads", "eiden-pfp"]).nullable().optional(),
  drive_account: z.string().max(40).nullable().optional(),
  // Office USB: after the Supabase upload, queue an async agent job that copies
  // the bytes to the router USB share. Never blocks the upload itself.
  usb: z.boolean().optional()
});

// Server-side mirror cap: above this the Vercel round-trip gets flaky —
// file stays local-only with a clear note instead of a timeout.
const PUSH_MAX = 50 * 1024 * 1024;

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  const body = p.data;
  if (body.storage_path && (!body.storage_path.startsWith(`${me.id}/`) || body.storage_path.includes(".."))) {
    return Response.json({ error: "storage_path must be inside your own upload folder" }, { status: 403 });
  }
  // Supabase can be toggled off per uploader — but then the bytes must come
  // from somewhere: a Google drive (via the direct-upload path, since the
  // mirror reads its bytes back out of Storage). No destination = 400.
  const want = body.drive_account === undefined ? "auto" : body.drive_account;
  if (!body.storage_path && !want) {
    return Response.json({ error: "no destination — turn on Supabase or a Google Drive first" }, { status: 400 });
  }
  if (!body.storage_path && want) {
    return Response.json({ error: "Supabase is off — send the bytes to the direct-upload endpoint instead" }, { status: 400 });
  }
  // Writes use the service role AFTER the checks above (never trust anon RLS for
  // mutations: a missing/rotated JWT must never turn into a data-loss-shaped error).
  const db = adminClient();
  // Uploads land only where you may write: Workspace commons or your own /
  // department-tagged folders. Smuggling files into another dept's folder 403s.
  if (body.folder) {
    const dst = await folderUsable(db, me, body.folder);
    if (!dst.ok) return Response.json({ error: dst.reason ?? "not allowed" }, { status: 403 });
  }
  const { data, error } = await db.from("file_index").insert({
    name: body.name, mime: body.mime ?? "application/octet-stream", size: body.size ?? 0,
    hash: body.hash ?? null, backends: body.backends ?? ["local"], owner: me.id, folder: body.folder ?? null,
    storage_path: body.storage_path ?? null, storage_bucket: body.storage_bucket ?? null
  }).select("id").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await db.from("versions").insert({ file_id: data.id, v: 1, hash: body.hash ?? "", actor: me.id });

  // Google mirror (quota-routed). Never blocks the upload: failures degrade to
  // local-only with push_error so the UI can say exactly why.
  let push_error: string | null = null;
  if (want && body.storage_path && (body.size ?? 0) > 0) {
    if ((body.size ?? 0) > PUSH_MAX) {
      push_error = "kept local-only: over the 50 MB instant-mirror size (still safe in Storage)";
    } else {
      const pick = await pickUploadAccount(body.size ?? 0, want === "auto" ? null : want);
      if (!pick.account) {
        push_error = pick.reason ?? "no drive available";
      } else {
        try {
          const srcBucket = body.storage_bucket === PFP_BUCKET ? PFP_BUCKET : UPLOAD_BUCKET;
          const { data: blob, error: dlErr } = await db.storage.from(srcBucket).download(body.storage_path);
          if (dlErr || !blob) throw new Error(dlErr?.message ?? "storage read failed");
          const d = clientFor(pick.account);
          if (!d) throw new Error("google not configured");
          const root = await rootFor(d, pick.account.root_id ?? "");
          const created = await d.files.create({
            supportsAllDrives: true,
            requestBody: {
              name: body.name,
              mimeType: body.mime ?? "application/octet-stream",
              ...(root.kind === "folder" ? { parents: [root.id] } : {})
            },
            // googleapis media bodies must be streams — a Buffer has no .pipe
            // and dies with "t.body.pipe is not a function".
            media: { mimeType: body.mime ?? "application/octet-stream", body: Readable.from(Buffer.from(await blob.arrayBuffer())) },
            fields: "id"
          });
          if (!created.data.id) throw new Error("google create returned no id");
          // Record the Drive parent: without it the scope filter can't place
          // this row inside a scoped drive and the file vanishes from Workspace.
          let google_parent_id: string | null = root.kind === "folder" ? root.id : null;
          if (!google_parent_id) {
            try {
              const meta = await d.files.get({ fileId: created.data.id, fields: "parents", supportsAllDrives: true });
              google_parent_id = (meta.data.parents?.[0] as string | undefined) ?? null;
            } catch { /* parent stays null — row still works, scope may hide it */ }
          }
          await db.from("file_index").update({
            google_file_id: created.data.id,
            google_parent_id,
            drive_account_id: pick.account.id,
            backends: ["local", "google"]
          }).eq("id", data.id);
        } catch (e) {
          push_error = googleErrorMessage(e instanceof Error ? e.message : "google mirror failed");
        }
      }
    }
  }
  await logAudit({ actor: me.id, actor_name: me.username, action: "add", file_id: data.id, req, detail: { backends: body.backends, push_error } });
  // Office-USB copy: queued, never blocking. Agent-offline just means "pending".
  // The agent pulls bytes from Supabase, so USB without a Storage copy is a
  // clear skip (not a silent drop) — the client normally disables USB already.
  let usb_queued: boolean | string = false;
  if (body.usb && body.storage_path) {
    try {
      await queueUsbUpload({ id: data.id, storage_path: body.storage_path, name: body.name, size: body.size ?? 0, owner: me.id, ownerName: me.username });
      usb_queued = true;
    } catch (e) {
      usb_queued = e instanceof Error ? e.message : "usb queue failed";
    }
  } else if (body.usb) {
    usb_queued = "skipped: USB copies pull from Supabase — turn Supabase on first";
  }
  await notifyUpload(db, req, { fileId: data.id, name: body.name, size: body.size, folderId: body.folder, userId: me.id, username: me.username });
  return Response.json({ ok: true, id: data.id, push_error, usb_queued });
}
