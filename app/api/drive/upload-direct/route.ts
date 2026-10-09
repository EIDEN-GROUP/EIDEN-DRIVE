export const dynamic = "force-dynamic";

import { Readable } from "node:stream";
import { adminClient } from "@/lib/supabase-admin";
import { logAudit } from "@/lib/audit";
import { getProfile } from "@/lib/roles";
import { rootFor } from "@/lib/google-drive";
import { googleErrorMessage } from "@/lib/errors";
import { pickUploadAccount, clientFor, getAccounts } from "@/lib/drive-accounts";
import { notifyUpload } from "@/lib/upload-notify";
import { folderUsable, googleInScope, bustScopeCache } from "@/lib/visibility";

// Direct-to-Google upload: for uploaders who turned Supabase off. The bytes
// ride the request body straight into Drive — Storage is never touched, so
// there is no Storage copy to preview, version, or USB-copy later.
//
// Same 50 MB server cap as the mirror path: above it the Vercel round-trip
// gets flaky, so big files must go through Supabase first.
const DIRECT_MAX = 50 * 1024 * 1024;

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "expected multipart form data" }, { status: 400 });
  }
  const blob = form.get("file");
  const name = String(form.get("name") ?? "").trim();
  const mime = String(form.get("mime") ?? "application/octet-stream").slice(0, 127);
  const folder = form.get("folder") ? String(form.get("folder")) : null;
  const hash = form.get("hash") ? String(form.get("hash")) : null;
  const driveAccount = form.get("drive_account") ? String(form.get("drive_account")) : undefined;
  const googleParentRaw = form.get("google_parent") ? String(form.get("google_parent")) : null;
  const google_parent = googleParentRaw && /^[A-Za-z0-9_-]{10,200}$/.test(googleParentRaw) ? googleParentRaw : null;
  if (form.get("google_parent") && !google_parent) {
    return Response.json({ error: "bad google_parent" }, { status: 400 });
  }
  if (!(blob instanceof Blob) || !name) {
    return Response.json({ error: "file + name required" }, { status: 400 });
  }
  if (name.length > 255) return Response.json({ error: "name too long" }, { status: 400 });
  if (hash && !/^[a-f0-9]{64}$/i.test(hash)) return Response.json({ error: "bad hash" }, { status: 400 });
  if (blob.size > DIRECT_MAX) {
    return Response.json({ error: "over 50 MB — turn Supabase on for big files (server mirror cap)" }, { status: 400 });
  }
  // No Supabase, no fallback: a drive is mandatory, not optional.
  const want = driveAccount === undefined ? "auto" : driveAccount || null;
  if (!want) {
    return Response.json({ error: "no destination — pick a Google Drive or turn Supabase on" }, { status: 400 });
  }
  const db = adminClient();
  if (folder) {
    const dst = await folderUsable(db, me, folder);
    if (!dst.ok) return Response.json({ error: dst.reason ?? "not allowed" }, { status: 403 });
  }
  const pick = await pickUploadAccount(blob.size, want === "auto" ? null : want);
  if (!pick.account) {
    return Response.json({ error: pick.reason ?? "no drive available" }, { status: 502 });
  }
  {
    const scopeRoot = pick.account.root_id ?? null;
    if (google_parent && scopeRoot && google_parent !== scopeRoot) {
      if (!(await googleInScope(db, await getAccounts(), pick.account.id, google_parent))) {
        return Response.json({ error: "destination folder is outside this drive's shared scope" }, { status: 403 });
      }
    }
  }
  try {
    const d = clientFor(pick.account);
    if (!d) throw new Error("google not configured");
    const root = await rootFor(d, pick.account.root_id ?? "");
    const created = await d.files.create({
      supportsAllDrives: true,
      requestBody: {
        name,
        mimeType: mime,
        ...(google_parent
          ? { parents: [google_parent] }
          : root.kind === "folder" ? { parents: [root.id] } : {})
      },
      media: { mimeType: mime, body: Readable.from(Buffer.from(await blob.arrayBuffer())) },
      fields: "id"
    });
    if (!created.data.id) throw new Error("google create returned no id");
    // Same parent bookkeeping as the mirror path: the scope filter places
    // rows by their Drive parent, and a parentless row is invisible on a
    // scoped drive.
    let google_parent_id: string | null = google_parent ?? (root.kind === "folder" ? root.id : null);
    if (!google_parent_id) {
      try {
        const meta = await d.files.get({ fileId: created.data.id, fields: "parents", supportsAllDrives: true });
        google_parent_id = (meta.data.parents?.[0] as string | undefined) ?? null;
      } catch { /* parent stays null */ }
    }
    const { data, error } = await db.from("file_index").insert({
      name, mime, size: blob.size, hash: hash ?? null,
      backends: ["google"], owner: me.id, folder,
      storage_path: null, google_file_id: created.data.id, google_parent_id, drive_account_id: pick.account.id
    }).select("id").single();
    if (error) throw new Error(error.message);
    await db.from("versions").insert({ file_id: data.id, v: 1, hash: hash ?? "", actor: me.id });
    bustScopeCache(pick.account.id);
    await logAudit({ actor: me.id, actor_name: me.username, action: "add", file_id: data.id, req, detail: { backends: ["google"], direct: true } });
    await notifyUpload(db, req, { fileId: data.id, name, size: blob.size, folderId: folder, userId: me.id, username: me.username });
    return Response.json({ ok: true, id: data.id });
  } catch (e) {
    return Response.json({ error: googleErrorMessage(e instanceof Error ? e.message : "google upload failed") }, { status: 502 });
  }
}
