import { createClient } from "./supabase-server";
import { adminClient, hasAdminClient } from "./supabase-admin";

export type AuditAction =
  | "view" | "add" | "edit" | "rename" | "move" | "trash" | "restore"
  | "perm-delete" | "share" | "download" | "upload-google" | "vault-view" | "login" | "ai-read" | "ai-upload";

export interface AuditEvent {
  actor?: string;
  actor_name: string;
  action: AuditAction | string;
  file_id?: string | null;
  detail?: Record<string, unknown>;
  ip?: string;
  user_agent?: string;
  device_id?: string;
}

function parseUA(ua = ""): { browser: string; os: string } {
  let browser = "Unknown", os = "Unknown";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = "Safari";
  if (/Windows/.test(ua)) os = "Windows";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad/.test(ua)) os = "iOS";
  else if (/Mac OS/.test(ua)) os = "macOS";
  else if (/Linux/.test(ua)) os = "Linux";
  return { browser, os };
}

export function getRequestMeta(req: Request): { ip: string; user_agent: string; browser: string; os: string } {
  const h = (n: string) => req.headers.get(n) ?? "";
  const ip = h("x-forwarded-for").split(",")[0].trim() || h("x-real-ip") || "unknown";
  const ua = h("user-agent");
  const { browser, os } = parseUA(ua);
  return { ip, user_agent: ua, browser, os };
}

// NOTE: browsers cannot expose MAC addresses. LAN MAC/hostname arrives via Local Agent
// and is stored in detail.mac / detail.hostname. Web events carry device_id (enrolled PWA).
export async function logAudit(e: AuditEvent & { req?: Request; mac?: string; hostname?: string }) {
  try {
    const supa = hasAdminClient() ? adminClient() : createClient();
    const meta = e.req ? getRequestMeta(e.req) : { ip: e.ip ?? "unknown", user_agent: e.user_agent ?? "", browser: "", os: "" };
    await supa.from("audit_logs").insert({
      actor: e.actor ?? null,
      actor_name: e.actor_name,
      action: e.action,
      file_id: e.file_id ?? null,
      detail: { ...(e.detail ?? {}), ...(e.mac ? { mac: e.mac } : {}), ...(e.hostname ? { hostname: e.hostname } : {}) },
      ip: meta.ip,
      user_agent: meta.user_agent,
      device_id: (e.detail as { device_id?: string } | undefined)?.device_id ?? null
    });
  } catch { /* audit must never break the request */ }
}
