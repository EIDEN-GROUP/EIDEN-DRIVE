export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { getAccounts, quotaFor, rootKind, clientFor, bustAccountCache } from "@/lib/drive-accounts";
import { rootFor } from "@/lib/google-drive";
import { parseJson } from "@/lib/http";

// Any signed-in user: drive labels + free space (powers the upload picker and
// Storage bars). No tokens ever leave the server.
export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const accounts = await getAccounts();
  const results = [];
  for (const a of accounts as (typeof accounts[number] & { refresh_token: string })[]) {
    let quota = { usage: null as number | null, limit: null as number | null, free: null as number | null, email: a.email };
    let rootKindName: string = a.status === "active" ? "mydrive" : "unknown";
    if (a.status === "active") {
      try {
        quota = await quotaFor(a);
        const d = clientFor(a);
        if (d) rootKindName = (await rootKind(d, a.root_id ?? "")).kind;
      } catch {
        rootKindName = "unreachable";
      }
    }
    results.push({
      id: a.id, label: a.label, email: quota.email ?? a.email,
      status: rootKindName === "unreachable" ? "down" : a.status,
      rootKind: rootKindName, rootId: a.root_id,
      usage: quota.usage, limit: quota.limit, free: quota.free
    });
  }
  return Response.json({ results, canManage: can(me.role, "manage-users") });
}

const Update = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(40).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  // Pin the account to a Shared Drive or My Drive folder ID. Empty string means
  // "whole My Drive" — only accepted with allowFullDrive:true, because that
  // scope is what floods the index with system dirs (node_modules & co).
  root_id: z.string().max(120).optional(),
  allowFullDrive: z.boolean().optional()
}).refine((v) => v.label !== undefined || v.status !== undefined || v.root_id !== undefined, { message: "nothing to update" });

// Managers+: rename a drive, disable it (sync/uploads skip disabled drives;
// files stay indexed and readable), or re-scope its root.
export async function PATCH(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "manage-users")) return Response.json({ error: "managers only" }, { status: 403 });
  const p = await parseJson(req, Update);
  if (p.error) return p.error;
  if (!hasAdminClient()) return Response.json({ error: "server not configured" }, { status: 503 });
  const db = adminClient();
  const { data: acct } = await db.from("drive_accounts").select("id,refresh_token").eq("id", p.data.id).maybeSingle();
  if (!acct) return Response.json({ error: "drive not found" }, { status: 404 });
  const patch: Record<string, unknown> = {};
  if (p.data.label !== undefined) patch.label = p.data.label;
  if (p.data.status !== undefined) patch.status = p.data.status;
  if (p.data.root_id !== undefined) {
    const root = p.data.root_id.trim();
    if (!root && !p.data.allowFullDrive) {
      return Response.json({ error: "empty root means the whole My Drive — tick the confirmation to accept that scope" }, { status: 400 });
    }
    // Validate BEFORE saving: wrong IDs fail here, not as mystery sync errors.
    try {
      const { driveClientFor } = await import("@/lib/google-drive");
      const d = driveClientFor((acct as { refresh_token: string }).refresh_token);
      if (!d) throw new Error("google not configured");
      await rootFor(d, root);
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : "root validation failed" }, { status: 400 });
    }
    patch.root_id = root || null;
  }
  const { error } = await db.from("drive_accounts").update(patch).eq("id", p.data.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  bustAccountCache();
  await logAudit({ actor: me.id, actor_name: me.username, action: "edit", req, detail: { drive_account: p.data.id, ...patch, root_id: patch.root_id !== undefined ? "set" : undefined } });
  return Response.json({ ok: true });
}

const Remove = z.object({ id: z.string().uuid() });

// Managers+: disconnect a drive entirely. Indexed file rows are kept but
// unpinned (drive_account_id → null, legacy resolution); Google copies are
// untouched — this only removes FileOS's access (the token row).
export async function DELETE(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "manage-users")) return Response.json({ error: "managers only" }, { status: 403 });
  const p = await parseJson(req, Remove);
  if (p.error) return p.error;
  if (!hasAdminClient()) return Response.json({ error: "server not configured" }, { status: 503 });
  const db = adminClient();
  await db.from("file_index").update({ drive_account_id: null }).eq("drive_account_id", p.data.id);
  const { error } = await db.from("drive_accounts").delete().eq("id", p.data.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  bustAccountCache();
  await logAudit({ actor: me.id, actor_name: me.username, action: "perm-delete", req, detail: { drive_account: p.data.id } });
  return Response.json({ ok: true });
}
