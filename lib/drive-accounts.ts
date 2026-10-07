import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { driveClient, driveClientFor, aboutFor, rootFor, type DriveLike, type DriveRoot } from "@/lib/google-drive";

export interface DriveAccount {
  id: string; label: string; email: string | null; root_id: string | null;
  status: string; priority: number;
}

// Safety headroom: never route an upload to a drive with less than this free
// (Google needs working room; uploads shouldn't be the thing that fills it).
export const SAFETY_MARGIN = 500 * 1024 * 1024;

let cache: { at: number; accounts: DriveAccount[] } | null = null;
const CACHE_MS = 60_000;

// All connected Google accounts. First call auto-imports the legacy
// GOOGLE_REFRESH_TOKEN env var as "Primary" so nothing breaks on upgrade.
export async function getAccounts(): Promise<DriveAccount[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.accounts;
  if (!hasAdminClient()) return [];
  const db = adminClient();
  const { data } = await db.from("drive_accounts").select("id,label,email,refresh_token,root_id,status,priority").order("priority", { ascending: false });
  let accounts = ((data ?? []) as (DriveAccount & { refresh_token: string })[]);
  if (accounts.length === 0 && process.env.GOOGLE_REFRESH_TOKEN) {
    const { data: created } = await db.from("drive_accounts").insert({
      label: "Primary", refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      root_id: process.env.GOOGLE_SHARED_DRIVE_ID ?? null, status: "active", priority: 0
    }).select("id,label,email,refresh_token,root_id,status,priority").single();
    if (created) accounts = [created as DriveAccount & { refresh_token: string }];
  }
  cache = { at: Date.now(), accounts };
  return accounts;
}
export function bustAccountCache() { cache = null; }

export function clientFor(acct: DriveAccount & { refresh_token: string }): DriveLike {
  return driveClientFor(acct.refresh_token);
}

// Resolve the working {drive, rootId} for a file operation: the file's pinned
// account when set, else the legacy single env connection. Null = unconfigured.
export async function driveCtxFor(accountId?: string | null): Promise<{ drive: DriveLike; rootId: string; label: string } | null> {
  if (accountId) {
    const accounts = await getAccounts() as (DriveAccount & { refresh_token: string })[];
    const a = accounts.find((x) => x.id === accountId && x.status === "active");
    if (a) return { drive: clientFor(a), rootId: a.root_id ?? "", label: a.label };
  }
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    return { drive: driveClient(), rootId: process.env.GOOGLE_SHARED_DRIVE_ID ?? "", label: "Primary" };
  }
  return null;
}

export async function rootKind(drive: DriveLike, rootId: string): Promise<DriveRoot> {
  return rootFor(drive, rootId);
}

export interface AccountQuota { usage: number | null; limit: number | null; free: number | null; email: string | null }

export async function quotaFor(acct: DriveAccount & { refresh_token: string }): Promise<AccountQuota> {
  const d = clientFor(acct);
  if (!d) return { usage: null, limit: null, free: null, email: acct.email };
  const a = await aboutFor(d);
  const free = a.usage !== null && a.limit !== null ? Math.max(a.limit - a.usage, 0) : null;
  return { usage: a.usage, limit: a.limit, free, email: a.email ?? acct.email };
}

// Upload routing: skip full/down drives, prefer explicit choice, else most free
// space (priority breaks ties). Returns the account or a human reason.
export async function pickUploadAccount(size: number, preferId?: string | null): Promise<{ account: (DriveAccount & { refresh_token: string }) | null; reason?: string; quotas?: Record<string, AccountQuota> }> {
  const accounts = await getAccounts() as (DriveAccount & { refresh_token: string })[];
  const live = accounts.filter((a) => a.status === "active");
  if (!live.length) return { account: null, reason: "no Google accounts connected — an admin can connect one from /api/auth/google" };
  const quotas: Record<string, AccountQuota> = {};
  for (const a of live) {
    try { quotas[a.id] = await quotaFor(a); }
    catch { quotas[a.id] = { usage: null, limit: null, free: null, email: a.email }; }
  }
  const fits = (a: DriveAccount) => {
    const q = quotas[a.id];
    if (q.free === null) return true; // unknown quota (e.g. unlimited Workspace) — allow
    return q.free >= size + SAFETY_MARGIN;
  };
  if (preferId) {
    const chosen = live.find((a) => a.id === preferId);
    if (!chosen) return { account: null, reason: "chosen drive not found", quotas };
    if (!fits(chosen)) return { account: null, reason: `"${chosen.label}" is too full for this file — pick another drive or free space`, quotas };
    return { account: chosen, quotas };
  }
  const candidates = live.filter(fits).sort((x, y) => (y.priority - x.priority) || 0);
  if (!candidates.length) {
    return { account: null, reason: "every connected drive is too full for this file — free space or connect another account", quotas };
  }
  // Most free space wins (quota unknown sorts last).
  candidates.sort((x, y) => (quotas[y.id].free ?? -1) - (quotas[x.id].free ?? -1));
  return { account: candidates[0], quotas };
}
