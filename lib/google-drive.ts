// Google Drive backend — Shared Drives primary.
// All functions degrade to stubs when env is missing so UI works without creds (.env left for the end).
import { google } from "googleapis";

function oauth() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) return null;
  const o = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  o.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return o;
}

export function driveClient() {
  const auth = oauth();
  if (!auth) return null;
  return google.drive({ version: "v3", auth });
}

export const SHARED_DRIVE_ID = () => process.env.GOOGLE_SHARED_DRIVE_ID ?? "";

export async function listDriveFiles(q = "", pageToken?: string) {
  const drive = driveClient();
  if (!drive) return { files: [], note: "google-not-configured" };
  const res = await drive.files.list({
    q: q ? `name contains '${q.replace(/[\\']/g, "")}' and trashed=false` : "trashed=false",
    fields: "files(id,name,mimeType,size,modifiedTime,owners),nextPageToken",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: SHARED_DRIVE_ID() ? "drive" : "user",
    ...(SHARED_DRIVE_ID() ? { driveId: SHARED_DRIVE_ID() } : {}),
    pageToken
  });
  return { files: res.data.files ?? [] };
}

export async function trashDriveFile(fileId: string) {
  const drive = driveClient();
  if (!drive) return { stub: true };
  return drive.files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true });
}

export async function restoreDriveFile(fileId: string) {
  const drive = driveClient();
  if (!drive) return { stub: true };
  return drive.files.update({ fileId, requestBody: { trashed: false }, supportsAllDrives: true });
}

// Temporary external permission with expiry (client folders) — max 1y per Google API.
export async function shareWithExpiry(fileId: string, email: string, role: "reader" | "commenter" | "writer" = "reader", expiryISO: string) {
  const drive = driveClient();
  if (!drive) return { stub: true };
  return drive.permissions.create({
    fileId,
    supportsAllDrives: true,
    requestBody: { type: "user", role, emailAddress: email, expirationTime: expiryISO }
  });
}
