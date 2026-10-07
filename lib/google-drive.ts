// Google Drive backend — Shared Drives primary.
// All functions degrade to stubs when env is missing so UI works without creds (.env left for the end).
import { google } from "googleapis";

export function oauthFor(refreshToken: string) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null;
  const o = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  o.setCredentials({ refresh_token: refreshToken });
  return o;
}

function oauth() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) return null;
  return oauthFor(GOOGLE_REFRESH_TOKEN);
}

export function driveClient() {
  const auth = oauth();
  if (!auth) return null;
  return google.drive({ version: "v3", auth });
}

export type DriveLike = ReturnType<typeof driveClient>;

// Per-account client (multi-drive). Null when app-level client id/secret missing.
export function driveClientFor(refreshToken: string): DriveLike {
  const auth = oauthFor(refreshToken);
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
// Parameterized core: same detection for the env root or any account root.
export async function rootFor(drive: DriveLike, id: string): Promise<DriveRoot> {
  if (!drive) throw new Error("google not configured");
  if (!id) return { kind: "mydrive" };
  try {
    await drive.drives.get({ driveId: id, fields: "id" });
    return { kind: "drive", id };
  } catch {
    try {
      const meta = await drive.files.get({ fileId: id, fields: "id,mimeType", supportsAllDrives: true });
      if (meta.data.mimeType !== "application/vnd.google-apps.folder") {
        throw new Error(`Drive root is neither a visible Shared Drive nor a folder (it is ${meta.data.mimeType ?? "unknown"}).`);
      }
      return { kind: "folder", id };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Drive root")) throw e;
      throw new Error("Drive root is not visible to the connected Google account — share the drive/folder with that account (see /api/health for which account is connected).");
    }
  }
}
export async function resolveRoot(): Promise<{ root: DriveRoot; note?: string }> {
  const drive = driveClient();
  if (!drive) return { root: { kind: "mydrive" }, note: "google-not-configured" };
  const id = SHARED_DRIVE_ID();
  if (!id) return { root: { kind: "mydrive" } };
  if (rootCache?.env === id) return { root: rootCache.root };
  const root = await rootFor(drive, id);
  rootCache = { env: id, root };
  return { root };
}

function esc(s: string) { return s.replace(/[\\']/g, ""); }

// BFS walk of a folder tree. `cursor` resumes across sync pages:
// { queue: [{ id, token? }], scanned } — serialized as the sync pageToken.
export interface FolderCursor { queue: { id: string; token?: string }[]; scanned: number }
async function walkFolderPage(pageToken?: string, rootId?: string, drive?: DriveLike): Promise<{ files: GFile[]; nextPageToken?: string }> {
  const d = drive ?? driveClient();
  if (!d) return { files: [] };
  const id = rootId ?? SHARED_DRIVE_ID();
  let cur: FolderCursor;
  try {
    cur = pageToken ? JSON.parse(Buffer.from(pageToken, "base64url").toString()) as FolderCursor : { queue: [{ id }], scanned: 0 };
  } catch { cur = { queue: [{ id }], scanned: 0 }; }
  const out: GFile[] = [];
  let calls = 0;
  while (cur.queue.length && out.length < 200 && calls < 8 && cur.scanned < 5000) {
    const head = cur.queue[0];
    const res = await d.files.list({
      q: `'${head.id}' in parents and trashed=false`,
      fields: "files(id,name,mimeType,size,modifiedTime,parents),nextPageToken",
      supportsAllDrives: true, includeItemsFromAllDrives: true,
      pageSize: 200, pageToken: head.token, orderBy: "folder,name"
    });
    calls++;
    for (const f of res.data.files ?? []) {
      cur.scanned++;
      // Folders are kept as entries (the sync persists them, the tree renders
      // them) AND queued for descent — files and folders share the page.
      if (f.mimeType === "application/vnd.google-apps.folder") cur.queue.push({ id: f.id! });
      out.push(f as GFile);
      if (out.length >= 200) break;
    }
    if (res.data.nextPageToken) head.token = res.data.nextPageToken;
    else cur.queue.shift();
  }
  const next = cur.queue.length ? Buffer.from(JSON.stringify(cur)).toString("base64url") : undefined;
  return { files: out, nextPageToken: next };
}

export async function listDriveFiles(q = "", pageToken?: string, acct?: { drive: DriveLike; rootId: string }) {
  const drive = acct?.drive ?? driveClient();
  if (!drive) return { files: [], note: "google-not-configured" };
  const root = acct ? await rootFor(drive, acct.rootId) : (await resolveRoot()).root;
  if (root.kind === "folder") {
    // Folder root: no server-side name search across the tree — walk it and
    // filter client-side (capped; the file_index search covers the rest).
    const pages = await walkFolderPage(undefined, root.id, drive);
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

export async function trashDriveFile(fileId: string, d?: DriveLike) {
  const drive = d ?? driveClient();
  if (!drive) return { stub: true };
  return drive.files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true });
}

export async function restoreDriveFile(fileId: string, d?: DriveLike) {
  const drive = d ?? driveClient();
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

// Same, but for any account client — powers per-account quota bars + routing.
export async function aboutFor(drive: DriveLike): Promise<{ email: string | null; usage: number | null; limit: number | null }> {
  const res = await drive!.about.get({ fields: "user(emailAddress),storageQuota" });
  const q = res.data.storageQuota;
  return {
    email: res.data.user?.emailAddress ?? null,
    usage: q?.usage ? Number(q.usage) : null,
    limit: q?.limit ? Number(q.limit) : null
  };
}

export interface GFile { id?: string | null; name?: string | null; mimeType?: string | null; size?: string | null; modifiedTime?: string | null; parents?: string[] | null }

// Single page pull (pageSize 200). The sync route calls this in a loop and the
// BROWSER chains requests — one Vercel invocation must never walk a whole drive,
// or large drives blow past the serverless timeout (HTTP 502).
export async function listDrivePage(pageToken?: string, acct?: { drive: DriveLike; rootId: string }): Promise<{ files: GFile[]; nextPageToken?: string; note?: string }> {
  const drive = acct?.drive ?? driveClient();
  if (!drive) return { files: [], note: "google-not-configured" };
  const root = acct ? await rootFor(drive, acct.rootId) : (await resolveRoot()).root;
  if (root.kind === "folder") return walkFolderPage(pageToken, root.id, drive);
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

export async function renameDriveFile(fileId: string, name: string, d?: DriveLike) {
  const drive = d ?? driveClient();
  if (!drive) return { stub: true };
  return drive.files.update({ fileId, requestBody: { name }, supportsAllDrives: true, fields: "id,name,modifiedTime" });
}
