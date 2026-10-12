import { adminClient } from "@/lib/supabase-admin";
import { bucketFor } from "@/lib/storage";
import { isBinned, googleInScope } from "@/lib/visibility";
import { driveCtxFor, accountAccessToken, getAccounts, driveGoneReason } from "@/lib/drive-accounts";
import { resolveShare, throttled } from "@/lib/share";

export const dynamic = "force-dynamic";

// Public bytes for a share link (the token IS the auth). Capped like the
// in-app preview; anything bigger must open the Drive page signed in.
const RAW_MAX = 25 * 1024 * 1024;

function denied(code?: string) {
  // Public route: always 404 (no account oracle), but the code tells the app
  // UI why — dead drives refuse instead of serving via a fallback token.
  return Response.json({ error: "this link is invalid, expired or revoked", ...(code ? { code } : {}) }, { status: 404 });
}

// Fail-closed drive pre-check for public bytes: deleted/disabled/legacy pins
// deny. The 404 shape is deliberate (no oracle); the code names the reason.
async function driveUsable(accountId?: string | null): Promise<string | null> {
  const block = await driveGoneReason(accountId);
  return block ? block.code : null;
}

// Served from the app's own origin with the uploader's MIME — treat as
// hostile (same policy as the in-app download route): script-capable types
// are download-only + sandboxed, never inline-executable.
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

async function load(token: string, ip: string) {
  if (throttled(`${token}:${ip}`)) return { error: Response.json({ error: "slow down — too many requests" }, { status: 429 }) };
  const s = await resolveShare(token);
  if (!s) return { error: denied() };
  return { shared: s };
}

export async function GET(req: Request, { params }: { params: { kind: string; token: string } }) {
  const { kind, token } = params;
  if (kind !== "raw" && kind !== "thumb" && kind !== "meta") return denied();
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const r = await load(token, ip);
  if ("error" in r) return r.error;
  const { file } = r.shared;
  // A trashed file's public link dies with it (restore revives the link too).
  if (await isBinned(adminClient(), file.id)) return denied();
  // Links are minted in-scope but rows outlive listings: re-scope must kill
  // the bytes too, not just the Workspace row. Revalidate on every serve.
  if (file.google_file_id && file.drive_account_id) {
    try {
      if (!(await googleInScope(adminClient(), await getAccounts(), file.drive_account_id, file.google_file_id))) return denied();
    } catch { return denied(); }
  }

  if (kind === "meta") {
    return Response.json({
      name: file.name, mime: file.mime, size: file.size, backends: file.backends,
      hasCover: !!file.google_file_id || file.mime.startsWith("image/") || file.mime.startsWith("video/")
    });
  }

  // Thumb: Google's server render when the file lives there, else nothing
  // (the share page falls back to its generic tile — never a broken image).
  if (kind === "thumb") {
    if (!file.google_file_id) return denied();
    const thumbBlock = await driveUsable(file.drive_account_id);
    if (thumbBlock) return denied(thumbBlock);
    try {
      const access = await accountAccessToken(file.drive_account_id);
      const meta = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.google_file_id)}?fields=thumbnailLink&supportsAllDrives=true`,
        { headers: { authorization: `Bearer ${access}` } }
      );
      const mj = (await meta.json()) as { thumbnailLink?: string };
      if (!meta.ok || !mj.thumbnailLink) return denied();
      const img = await fetch(mj.thumbnailLink.replace(/=s\d+$/, "=s400"), { headers: { authorization: `Bearer ${access}` } });
      if (!img.ok) return denied();
      const ibuf = Buffer.from(await img.arrayBuffer());
      const iab = new ArrayBuffer(ibuf.byteLength);
      new Uint8Array(iab).set(ibuf);
      return new Response(iab, {
        headers: { "content-type": img.headers.get("content-type") ?? "image/jpeg", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" }
      });
    } catch {
      return denied();
    }
  }

  // Raw bytes, with Range support so video/audio seek instead of stalling.
  // Both branches cap at RAW_MAX: the whole blob is buffered into memory, so
  // an uncapped branch is a one-link OOM (the index `size` is checked, not trusted blindly — the buffer is what matters).
  try {
    if (typeof file.size === "number" && file.size > RAW_MAX) {
      return Response.json({ error: "too large for link preview — open it signed in" }, { status: 400 });
    }
    let buf: Buffer;
    if (file.storage_path) {
      const { data: blob, error } = await adminClient().storage.from(bucketFor(file)).download(file.storage_path);
      if (error || !blob) return denied();
      buf = Buffer.from(await blob.arrayBuffer());
      if (buf.byteLength > RAW_MAX) {
        return Response.json({ error: "too large for link preview — open it signed in" }, { status: 400 });
      }
    } else if (file.google_file_id) {
      const rawBlock = await driveUsable(file.drive_account_id);
      if (rawBlock) return denied(rawBlock);
      const ctx = await driveCtxFor(file.drive_account_id);
      const g = ctx?.drive;
      if (!g) return denied("drive_disabled");
      const dl = await g.files.get({ fileId: file.google_file_id, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
      buf = Buffer.from(dl.data as ArrayBuffer);
    } else {
      return denied();
    }
    // Plain ArrayBuffer copy: Buffer's shared-memory typing isn't Response-safe.
    const ab = new ArrayBuffer(buf.byteLength);
    new Uint8Array(ab).set(buf);
    const range = req.headers.get("range");
    const mime = file.mime || "application/octet-stream";
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        const start = m[1] ? Number(m[1]) : 0;
        const end = m[2] ? Math.min(Number(m[2]), ab.byteLength - 1) : ab.byteLength - 1;
        if (!Number.isNaN(start) && !Number.isNaN(end) && start <= end && start < ab.byteLength) {
          return new Response(ab.slice(start, end + 1), {
            status: 206,
            headers: {
              "content-length": String(end - start + 1),
              "content-range": `bytes ${start}-${end}/${ab.byteLength}`,
              "accept-ranges": "bytes", ...rawHeaders(mime, file.name)
            }
          });
        }
      }
      return new Response("range not satisfiable", { status: 416 });
    }
    return new Response(ab, {
      headers: { "content-length": String(ab.byteLength), "accept-ranges": "bytes", ...rawHeaders(mime, file.name) }
    });
  } catch {
    return denied();
  }
}
