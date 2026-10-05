import { createClient } from "@/lib/supabase-server";

export const UPLOAD_BUCKET = "eiden-uploads";
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB per file

// Signed upload URL so bytes go straight from browser -> Supabase Storage (never via Vercel).
export async function signedUploadUrl(path: string, mime: string) {
  const supa = createClient();
  const { data, error } = await supa.storage.from(UPLOAD_BUCKET).createSignedUploadUrl(path);
  if (error) throw new Error(error.message);
  return { ...data, mime };
}
