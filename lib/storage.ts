import { adminClient } from "@/lib/supabase-admin";

export const UPLOAD_BUCKET = "eiden-uploads";
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1000; // 100 MB per file

// Signed upload URL so bytes go straight from browser -> Supabase Storage (never via Vercel).
// MUST use the service role: the anon client has no INSERT grant on storage.objects
// (no member storage policy exists), so createSignedUploadUrl fails with
// "new row violates row-level security policy". Path scoping (caller-own prefix)
// is enforced by the /upload-url route before this is called.
export async function signedUploadUrl(path: string, mime: string) {
  const supa = adminClient();
  const { data, error } = await supa.storage.from(UPLOAD_BUCKET).createSignedUploadUrl(path);
  if (error) throw new Error(error.message);
  return { ...data, mime };
}
