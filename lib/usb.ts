import { adminClient } from "@/lib/supabase-admin";
import { UPLOAD_BUCKET } from "@/lib/storage";

// Office-USB pipeline (async by design — the office PC agent may be offline).
// A "usb-upload" job carries everything the agent needs: a long-lived signed
// URL for the bytes + where to put them on the share. The agent reports back
// via POST /api/agent/complete, which flips the job and pins the "usb" backend.
export const USB_JOB = "usb-upload";
export const USB_URL_TTL = 7 * 24 * 3600; // signed bytes URL valid 7 days

export async function queueUsbUpload(file: { id: string; storage_path: string; storage_bucket?: string | null; name: string; size: number; owner: string; ownerName: string }): Promise<{ jobId: string }> {
  const db = adminClient();
  const { data: signed, error: sErr } = await db.storage.from(file.storage_bucket || UPLOAD_BUCKET).createSignedUrl(file.storage_path, USB_URL_TTL);
  if (sErr || !signed?.signedUrl) throw new Error(`couldn't sign bytes for the agent: ${sErr?.message ?? "unknown"}`);
  const { data, error } = await db.from("jobs").insert({
    kind: USB_JOB,
    status: "pending",
    payload: {
      file_id: file.id, name: file.name, size: file.size,
      url: signed.signedUrl, dest: `eiden/${file.name}`,
      by: file.ownerName, owner: file.owner
    }
  }).select("id").single();
  if (error) throw new Error(error.message);
  return { jobId: (data as { id: string }).id };
}
