import { adminClient } from "@/lib/supabase-admin";

export const UPLOAD_BUCKET = "eiden-uploads";
// Profile pictures live apart from file bytes so Storage stays crawlable and
// avatar cleanup never risks user files. file_index.storage_bucket pins which
// bucket a row lives in; NULL = legacy eiden-uploads.
export const PFP_BUCKET = "eiden-pfp";
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1000; // 100 MB per file

// Which bucket a file row's bytes live in (tolerates pre-0017 rows).
export function bucketFor(row: { storage_bucket?: string | null } | null | undefined): string {
  return row?.storage_bucket || UPLOAD_BUCKET;
}

// Signed upload URL so bytes go straight from browser -> Supabase Storage (never via Vercel).
// MUST use the service role: the anon client has no INSERT grant on storage.objects
// (no member storage policy exists), so createSignedUploadUrl fails with
// "new row violates row-level security policy". Path scoping (caller-own prefix)
// is enforced by the /upload-url route before this is called.
export async function signedUploadUrl(path: string, mime: string, bucket: string = UPLOAD_BUCKET) {
  const supa = adminClient();
  const { data, error } = await supa.storage.from(bucket).createSignedUploadUrl(path);
  if (error) throw new Error(error.message);
  return { ...data, mime };
}

// 5-minute signed download link (same reasoning as above).
export async function signedDownloadUrl(path: string, seconds = 300, bucket: string = UPLOAD_BUCKET) {
  const { data, error } = await adminClient().storage.from(bucket).createSignedUrl(path, seconds);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// Avatar read: eiden-pfp first, legacy eiden-uploads as fallback so pictures
// keep loading before/during the bucket migration.
export async function avatarUrlFor(path: string | null | undefined, seconds = 300): Promise<string | null> {
  if (!path) return null;
  try {
    return await signedDownloadUrl(path, seconds, PFP_BUCKET);
  } catch {
    try {
      return await signedDownloadUrl(path, seconds, UPLOAD_BUCKET);
    } catch {
      return null;
    }
  }
}
