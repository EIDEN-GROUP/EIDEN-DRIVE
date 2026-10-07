export const dynamic = "force-dynamic";

import { z } from "zod";
import { createClient } from "@/lib/supabase-server";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { signedDownloadUrl, UPLOAD_BUCKET } from "@/lib/storage";
import { driveCtxFor } from "@/lib/drive-accounts";
import { parseQuery } from "@/lib/http";

const Q = z.object({ file_id: z.string().max(300), raw: z.string().optional(), json: z.string().optional() });

// Raw bytes are served from the app's own origin, and the MIME type is whatever the uploader declared — so treat it as
// hostile: never let the browser sniff, and anything that can run script (HTML/SVG/XML/JS) is download-only and
// sandboxed if someone opens the URL directly. The in-app viewer reads these bytes as data and renders them safely.
function rawHeaders(mime: string, name: string): Record<string, string> {
  const risky = /^(text\/html|application\/xhtml|image\/svg|text\/xml|application\/xml|text\/javascript|application\/javascript)/i.test(mime) || /\.(x?html?|svg|xml|m?js)$/i.test(name);
  return {
    "content-type": mime,
    "content-disposition": `${risky ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-store",
    ...(risky ? { "content-security-policy": "sandbox; default-src 'none'" } : {})
  };
}

const RAW_MAX = 25 * 1024 * 1024; // in-app preview cap — bigger files use Download

// Parses live (not yet synced) Google ids: g:<accountId>:<googleFileId>
// (legacy single-connection rows are g:<googleFileId>).
function parseLiveId(file_id: string): { accountId: string | null; googleId: string } | null {
  if (!file_id.startsWith("g:")) return null;
  const rest = file_id.slice(2);
  const i = rest.indexOf(":");
  if (i < 0) return { accountId: null, googleId: rest };
  return { accountId: rest.slice(0, i) || null, googleId: rest.slice(i + 1) };
}

// Real download: Supabase-hosted bytes get a 5-min signed URL; Google-hosted files
// redirect to the Drive viewer (bytes stay in Google, permissions enforced there too).
// ?json=1 → { url } instead of redirect (viewer embedding). ?raw=1 → bytes streamed
// through the server (needed for in-app preview of Google files + text extraction).
// Live g: ids stream raw directly from the right account — no index row needed.
export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = parseQuery(req, Q);
  if (p.error) return p.error;
  const { file_id } = p.data;
  const live = parseLiveId(file_id);
  if (live && p.data.raw) {
    try {
      const ctx = await driveCtxFor(live.accountId);
      const g = ctx?.drive;
      if (!g) throw new Error("google not configured");
      const meta = await g.files.get({ fileId: live.googleId, fields: "size,mimeType,name", supportsAllDrives: true });
      if (Number(meta.data.size ?? 0) > RAW_MAX) {
        return Response.json({ error: "file too large to preview — use Download", too_large: true }, { status: 400 });
      }
      const dl = await g.files.get({ fileId: live.googleId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
      const name = String(meta.data.name ?? "file");
      const mime = String(meta.data.mimeType ?? "application/octet-stream");
      await logAudit({ actor: me.id, actor_name: me.username, action: "download", req, detail: { live_google: live.googleId } });
      return new Response(Buffer.from(dl.data as ArrayBuffer), {
        headers: rawHeaders(mime, name)
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : "preview failed";
      if (/not.?found|404/i.test(m)) return Response.json({ error: "Google copy missing — the Drive file was deleted or unshared", gone: true }, { status: 404 });
      return Response.json({ error: m }, { status: 500 });
    }
  }
  if (live && !p.data.raw) {
    // No direct download URL exists for live rows (Drive blocks framing and
    // direct links need cookies) — the viewer streams them via ?raw=1 instead.
    return Response.json({ error: "open this file in the viewer (preview) — direct download needs a synced copy", live: true }, { status: 400 });
  }
  const supa = createClient();
  const { data: f } = await supa.from("file_index").select("id,name,mime,size,storage_path,google_file_id,drive_account_id").eq("id", file_id).maybeSingle();
  if (!f) return Response.json({ error: "not found" }, { status: 404 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "download", file_id, req });
  if (p.data.json) {
    if (f.storage_path) {
      try { return Response.json({ url: await signedDownloadUrl(f.storage_path), mime: f.mime }); }
      catch (e) { return Response.json({ error: e instanceof Error ? e.message : "could not sign download" }, { status: 500 }); }
    }
    // No direct-embed URL exists for Google files (Drive blocks framing) —
    // the viewer uses ?raw=1 for those instead.
    return Response.json({ error: "use raw=1 for Google-hosted previews", google_file: true }, { status: 400 });
  }
  if (p.data.raw) {
    if (typeof f.size === "number" && f.size > RAW_MAX) {
      return Response.json({ error: "file too large to preview — use Download", too_large: true }, { status: 400 });
    }
    try {
      if (f.storage_path) {
        const db = adminClient();
        const { data: blob, error } = await db.storage.from(UPLOAD_BUCKET).download(f.storage_path);
        if (error || !blob) throw new Error(error?.message ?? "storage read failed");
        return new Response(blob, { headers: rawHeaders(f.mime ?? "application/octet-stream", f.name) });
      }
      if (f.google_file_id) {
        const ctx = await driveCtxFor((f as { drive_account_id?: string | null }).drive_account_id);
        const g = ctx?.drive;
        if (!g) throw new Error("google not configured");
        const meta = await g.files.get({ fileId: f.google_file_id, fields: "size,mimeType", supportsAllDrives: true });
        if (Number(meta.data.size ?? 0) > RAW_MAX) {
          return Response.json({ error: "file too large to preview — use Download", too_large: true }, { status: 400 });
        }
        const dl = await g.files.get({ fileId: f.google_file_id, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
        return new Response(Buffer.from(dl.data as ArrayBuffer), {
          headers: rawHeaders(f.mime ?? (meta.data.mimeType as string) ?? "application/octet-stream", f.name)
        });
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : "preview failed";
      if (/not.?found|404/i.test(m)) return Response.json({ error: "Google copy missing — the Drive file was deleted or unshared", gone: true }, { status: 404 });
      return Response.json({ error: m }, { status: 500 });
    }
  }
  if (f.storage_path) {
    try { return Response.redirect(await signedDownloadUrl(f.storage_path), 302); }
    catch (e) { return Response.json({ error: e instanceof Error ? e.message : "could not sign download" }, { status: 500 }); }
  }
  if (f.google_file_id) {
    return Response.redirect(`https://drive.google.com/file/d/${f.google_file_id}/view`, 302);
  }
  return Response.json({ error: "no downloadable copy yet" }, { status: 404 });
}
