import { createClient } from "./supabase-server";

export type AlertKind =
  | "storage-80" | "storage-95" | "backup-stale" | "backup-fail" | "agent-offline"
  | "large-download" | "mass-delete" | "external-share" | "vault-view"
  | "failed-logins" | "purge-soon" | "approval-pending";

export async function notify(user_id: string | null, kind: AlertKind, title: string, body: string) {
  try {
    const supa = createClient();
    await supa.from("notifications").insert({ user_id, kind, title, body });
  } catch { /* never break */ }
}

// Threshold checks called by /api/storage + agent heartbeat. Pure + testable.
export function storageAlert(used: number, total: number): AlertKind | null {
  if (!total) return null;
  const pct = used / total;
  if (pct >= 0.95) return "storage-95";
  if (pct >= 0.8) return "storage-80";
  return null;
}

export function isMassDelete(count: number, windowMin = 10): boolean {
  return count >= 20 && windowMin <= 10;
}

export function isLargeDownload(bytes: number): boolean {
  return bytes >= 2 * 1024 ** 3; // 2GB
}
