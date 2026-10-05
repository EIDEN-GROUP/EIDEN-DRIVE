// Single source of truth for Google OAuth settings.
export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/drive"];

// Must EXACTLY match an Authorized redirect URI in Google Cloud Console.
// You already set: https://drive.eiden-group.com/api/auth/google/callback
export function GOOGLE_REDIRECT_URI(): string {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://drive.eiden-group.com";
  return `${base.replace(/\/$/, "")}/api/auth/google/callback`;
}
