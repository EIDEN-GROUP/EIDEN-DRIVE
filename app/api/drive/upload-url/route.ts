export const dynamic = "force-dynamic";

import { z } from "zod";
import { getProfile } from "@/lib/roles";
import { signedUploadUrl, MAX_UPLOAD_BYTES, UPLOAD_BUCKET, PFP_BUCKET } from "@/lib/storage";
import { requireActiveAccount, driveBlockedResponse } from "@/lib/drive-accounts";
import { rateLimited } from "@/lib/rate";
import { parseJson } from "@/lib/http";

const Body = z.object({ name: z.string().min(1).max(255), mime: z.string().max(127).default("application/octet-stream"), size: z.number().int().positive().max(MAX_UPLOAD_BYTES), bucket: z.enum(["uploads", "pfp"]).optional(),
  // Intended mirror target: validated NOW (fresh, uncached) so an unavailable
  // drive fails before a single byte moves — not after the PUT lands.
  drive_account: z.string().uuid().nullable().optional() });

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  const body = p.data;
  // Abuse damping: each mint is a writable Storage URL — no unlimited minting.
  if (rateLimited(`upload-url:${me.id}`, 30)) {
    return Response.json({ error: "slow down — too many upload inits" }, { status: 429 });
  }
  // Profile pictures never touch a Google drive: the pfp bucket is their only
  // destination, so a drive pin alongside it is a forged/ confused call.
  if (body.bucket === "pfp" && body.drive_account) {
    return Response.json({ error: "profile pictures don't use Google drives" }, { status: 400 });
  }
  // Fail BEFORE bytes move: a pinned drive that is gone/disabled refuses here,
  // while the register step re-checks (status may flip mid-upload).
  if (body.drive_account) {
    const chk = await requireActiveAccount(body.drive_account);
    if ("error" in chk) return driveBlockedResponse(chk);
  }
  const safe = body.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${me.id}/${Date.now()}-${safe}`;
  const bucket = body.bucket === "pfp" ? PFP_BUCKET : UPLOAD_BUCKET;
  try {
    const url = await signedUploadUrl(path, body.mime, bucket);
    return Response.json({ ok: true, ...url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "upload init failed";
    const missing = /bucket|Bucket|not found/i.test(msg);
    // Bucket names stay server-side: the client learns what to do, not what
    // the infrastructure is called.
    return Response.json({ error: missing ? "File storage isn't set up yet — ask an admin to create the private Storage buckets, then retry." : "Couldn't start the upload — retry." }, { status: 400 });
  }
}
