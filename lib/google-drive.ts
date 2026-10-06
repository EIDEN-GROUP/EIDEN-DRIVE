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

// Root resolution: GOOGLE_SHARED_DRIVE_ID accepts EITHER a Shared Drive ID
// (Workspace) OR a regular My Drive folder ID (any Gmail account — e.g. a folder
// named "eiden-drive" in a personal inbox). Empty = whole My Drive.
// Result is cached per process; a changed env value re-resolves on next deploy.
export type DriveRoot = { kind: "drive"; id: string } | { kind: "folder"; id: string } | { kind: "mydrive" };
let rootCache: { env: string; root: DriveRoot } | null = null;
export async function resolveRoot(): Promise<{ root: DriveRoot; note?: string }> {
  const drive = driveClient();
  if (!drive) return { root: { kind: "mydrive" }, note: "google-not-configured" };
  const id = SHARED_DRIVE_ID();
  if (!id) return { root: { kind: "mydrive" } };
  if (rootCache?.env === id) return { root: rootCache.root };
  let root: DriveRoot;
  try {
    await drive.drives.get({ driveId: id, fields: "id" });
    root = { kind: "drive", id };
  } catch {
    // Not a visible Shared Drive — maybe a My Drive folder ID?
    try {
      const meta = await drive.files.get({ fileId: id, fields: "id,mimeType", supportsAllDrives: true });
      if (meta.data.mimeType !== "application/vnd.google-apps.folder") {
        throw new Error(`GOOGLE_SHARED_DRIVE_ID is neither a visible Shared Drive nor a folder (it is ${meta.data.mimeType ?? "unknown"}).`);
      }
      root = { kind: "folder", id };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("GOOGLE_SHARED_DRIVE_ID")) throw e;
      throw new Error("GOOGLE_SHARED_DRIVE_ID is not visible to the connected Google account — share the drive/folder with that account (see /api/health for which account is connected).");
    }
  }
  rootCache = { env: id, root };
  return { root };
}

function esc(s: string) { return s.replace(/[\\']/g, ""); }

// BFS walk of a folder tree. `cursor` resumes across sync pages:
// { queue: [{ id, token? }], scanned } — serialized as the sync pageToken.
export interface FolderCursor { queue: { id: string; token?: string }[]; scanned: number }
async function walkFolderPage(pageToken?: string): Promise<{ files: GFile[]; nextPageToken?: string }> {
  const drive = driveClient();
  if (!drive) return { files: [] };
  const id = SHARED_DRIVE_ID();
  let cur: FolderCursor;
  try {
    cur = pageToken ? JSON.parse(Buffer.from(pageToken, "base64url").toString()) as FolderCursor : { queue: [{ id }], scanned: 0 };
  } catch { cur = { queue: [{ id }], scanned: 0 }; }
  const out: GFile[] = [];
  let calls = 0;
  while (cur.queue.length && out.length < 200 && calls < 8 && cur.scanned < 5000) {
    const head = cur.queue[0];
    const res = await drive.files.list({
      q: `'${head.id}' in parents and trashed=false`,
      fields: "files(id,name,mimeType,size,modifiedTime,parents),nextPageToken",
      supportsAllDrives: true, includeItemsFromAllDrives: true,
      pageSize: 200, pageToken: head.token, orderBy: "folder,name"
    });
    calls++;
    for (const f of res.data.files ?? []) {
      cur.scanned++;
      if (f.mimeType === "application/vnd.google-apps.folder") cur.queue.push({ id: f.id! });
      else out.push(f as GFile);
      if (out.length >= 200) break;
    }
    if (res.data.nextPageToken) head.token = res.data.nextPageToken;
    else cur.queue.shift();
  }
  const next = cur.queue.length ? Buffer.from(JSON.stringify(cur)).toString("base64url") : undefined;
  return { files: out, nextPageToken: next };
}

export async function listDriveFiles(q = "", pageToken?: string) {
  const drive = driveClient();
  if (!drive) return { files: [], note: "google-not-configured" };
  const { root } = await resolveRoot();
  if (root.kind === "folder") {
    // Folder root: no server-side name search across the tree — walk it and
    // filter client-side (capped; the file_index search covers the rest).
    const pages = await walkFolderPage();
    const needle = esc(q).toLowerCase();
    const hit = pages.files.filter((f) => !q || (f.name ?? "").toLowerCase().includes(needle)).slice(0, 10);
    return { files: hit };
  }
  const res = await drive.files.list({
    q: q ? `name contains '${esc(q)}' and trashed=false` : "trashed=false",
    fields: "files(id,name,mimeType,size,modifiedTime,owners),nextPageToken",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: root.kind === "drive" ? "drive" : "user",
    ...(root.kind === "drive" ? { driveId: root.id } : {}),
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

// Real quota for the Storage page. Null when Google isn't configured.
export async function getAboutQuota(): Promise<{ usage: number; limit: number } | null> {
  const drive = driveClient();
  if (!drive) return null;
  const res = await drive.about.get({ fields: "storageQuota" });
  const q = res.data.storageQuota;
  if (!q?.usage || !q?.limit) return null;
  return { usage: Number(q.usage), limit: Number(q.limit) };
}

export interface GFile { id?: string | null; name?: string | null; mimeType?: string | null; size?: string | null; modifiedTime?: string | null; parents?: string[] | null }

// Single page pull (pageSize 200). The sync route calls this in a loop and the
// BROWSER chains requests — one Vercel invocation must never walk a whole drive,
// or large drives blow past the serverless timeout (HTTP 502).
export async function listDrivePage(pageToken?: string): Promise<{ files: GFile[]; nextPageToken?: string; note?: string }> {
  const drive = driveClient();
  if (!drive) return { files: [], note: "google-not-configured" };
  const { root } = await resolveRoot();
  if (root.kind === "folder") return walkFolderPage(pageToken);
  const res = await drive.files.list({
    q: "trashed=false",
    fields: "files(id,name,mimeType,size,modifiedTime,parents),nextPageToken",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: root.kind === "drive" ? "drive" : "user",
    ...(root.kind === "drive" ? { driveId: root.id } : {}),
    pageSize: 200,
    pageToken
  });
  return { files: res.data.files ?? [], nextPageToken: res.data.nextPageToken ?? undefined };
}

// Full pull: pages through EVERYTHING (up to `cap`) so the index mirrors Google,
// not just the top-10 live fallback. Used by POST /api/drive/sync.
export async function listAllDriveFiles(cap = 2000): Promise<{ files: GFile[]; note?: string }> {
  const drive = driveClient();
  if (!drive) return { files: [], note: "google-not-configured" };
  const out: GFile[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: "trashed=false",
      fields: "files(id,name,mimeType,size,modifiedTime,parents),nextPageToken",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: SHARED_DRIVE_ID() ? "drive" : "user",
      ...(SHARED_DRIVE_ID() ? { driveId: SHARED_DRIVE_ID() } : {}),
      pageSize: 1000,
      pageToken
    });
    out.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && out.length < cap);
  return { files: out.slice(0, cap) };
}

export async function renameDriveFile(fileId: string, name: string) {
  const drive = driveClient();
  if (!drive) return { stub: true };
  return drive.files.update({ fileId, requestBody: { name }, supportsAllDrives: true, fields: "id,name,modifiedTime" });
}
