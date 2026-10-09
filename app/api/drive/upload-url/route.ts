export const dynamic = "force-dynamic";

import { z } from "zod";
import { getProfile } from "@/lib/roles";
import { signedUploadUrl, MAX_UPLOAD_BYTES, UPLOAD_BUCKET, PFP_BUCKET } from "@/lib/storage";
import { parseJson } from "@/lib/http";

const Body = z.object({ name: z.string().min(1).max(255), mime: z.string().max(127).default("application/octet-stream"), size: z.number().int().positive().max(MAX_UPLOAD_BYTES), bucket: z.enum(["uploads", "pfp"]).optional() });

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  const body = p.data;
  const safe = body.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${me.id}/${Date.now()}-${safe}`;
  const bucket = body.bucket === "pfp" ? PFP_BUCKET : UPLOAD_BUCKET;
  try {
    const url = await signedUploadUrl(path, body.mime, bucket);
    return Response.json({ ok: true, ...url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "upload init failed";
    const missing = /bucket|Bucket|not found/i.test(msg);
    return Response.json({ error: missing ? `Storage bucket '${bucket}' is not created yet. Create it (private) in Supabase > Storage, then retry.` : msg }, { status: 400 });
  }
}
