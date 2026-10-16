export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { canTouch, folderUsable, googleInScope, googlePinOf } from "@/lib/visibility";
import { getAccounts } from "@/lib/drive-accounts";
import {
  isMuted, workspaceEffectiveMuted, driveEffectiveMuted,
  workspaceDescendants, driveDescendants, type MuteDescendant,
} from "@/lib/folder-slack-mute";

// Folder Slack-mute state + toggling. Any member with folder access may read
// or change it (same gate as tagging); every change is audited. Muting
// suppresses ONLY the Slack fan-out for uploads landing in the folder or its
// descendants — in-app notifications and audit logging are unaffected.

// Resolve the dialog target from query/body params to a canonical target,
// or return an error response. Drive targets must be indexed folder rows.
async function resolveTarget(db: ReturnType<typeof adminClient>, me: { id: string; role: string; department_tag?: string | null },
  scope: string, id: string, account?: string
): Promise<
  | { ok: true; target: { scope: "workspace"; folderId: string } | { scope: "drive"; accountId: string; googleId: string }; label: string }
  | { ok: false; res: Response }
> {
  if (scope === "workspace") {
    const dst = await folderUsable(db, me, id);
    if (!dst.ok) return { ok: false, res: Response.json({ error: dst.reason ?? "not allowed" }, { status: 403 }) };
    const { data } = await db.from("folders").select("name").eq("id", id).maybeSingle();
    if (!data) return { ok: false, res: Response.json({ error: "folder not found" }, { status: 404 }) };
    return { ok: true, target: { scope: "workspace", folderId: id }, label: (data as { name: string }).name };
  }
  if (scope === "drive" && account) {
    const { data } = await db.from("file_index")
      .select("id,name,owner,folder,google_file_id,google_parent_id,drive_account_id")
      .eq("id", id).eq("drive_account_id", account)
      .eq("mime", "application/vnd.google-apps.folder").maybeSingle();
    const row = (data ?? null) as {
      id: string; name: string; owner: string; folder: string | null;
      google_file_id: string | null; google_parent_id: string | null; drive_account_id: string | null;
    } | null;
    if (!row?.google_file_id) return { ok: false, res: Response.json({ error: "folder not found" }, { status: 404 }) };
    const gate = await canTouch(db, me, { id: row.id, owner: row.owner ?? "", folder: row.folder }, googlePinOf(row));
    if (!gate.ok) return { ok: false, res: Response.json({ error: gate.reason ?? "not allowed" }, { status: 403 }) };
    if (!(await googleInScope(db, await getAccounts(), row.drive_account_id, row.google_file_id))) {
      return { ok: false, res: Response.json({ error: "outside this drive's shared scope" }, { status: 403 }) };
    }
    return { ok: true, target: { scope: "drive", accountId: account, googleId: row.google_file_id }, label: row.name };
  }
  return { ok: false, res: Response.json({ error: "bad target" }, { status: 400 }) };
}

// GET /api/folders/slack-mute?scope=workspace&id= | ?scope=drive&id=<index-id>&account=
// Dialog payload: target state + every descendant subfolder with its own and
// effective mute state. Inaccessible rows never appear.
export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const u = new URL(req.url);
  const scope = u.searchParams.get("scope") ?? "";
  const id = u.searchParams.get("id") ?? "";
  const account = u.searchParams.get("account") ?? undefined;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  const db = adminClient();
  const t = await resolveTarget(db, me, scope, id, account);
  if (!t.ok) return t.res;

  const muted = await isMuted(db, t.target);
  const effective = t.target.scope === "workspace"
    ? await workspaceEffectiveMuted(db, t.target.folderId)
    : await driveEffectiveMuted(db, t.target.accountId, t.target.googleId);

  // The full descendant tree is only needed by the mute dialog (?tree=1);
  // state checks (Details panel) skip it to stay cheap.
  if (u.searchParams.get("tree") !== "1") {
    return Response.json({ ok: true, label: t.label, muted, effectiveMuted: effective, descendants: [] });
  }

  const descendants: MuteDescendant[] = [];
  if (t.target.scope === "workspace") {
    const subs = await workspaceDescendants(db, t.target.folderId);
    // Depth + path from the parent map (bounded; built from the same rows).
    const { data: all } = await db.from("folders").select("id,name,parent").limit(2000);
    const byId = new Map(((all ?? []) as { id: string; name: string; parent: string | null }[]).map((f) => [f.id, f]));
    const depthOf = (fid: string): number => {
      let d = 0, cur: string | null = fid;
      const seen = new Set<string>();
      while (cur && !seen.has(cur) && d < 200) {
        seen.add(cur);
        const p: string | null = byId.get(cur)?.parent ?? null;
        if (!p) break;
        d++;
        cur = p;
      }
      return d;
    };
    for (const s of subs) {
      const m = await isMuted(db, { scope: "workspace", folderId: s.id });
      const e = m || await workspaceEffectiveMuted(db, s.id);
      descendants.push({ id: s.id, label: s.name, path: s.name, depth: depthOf(s.id), muted: m, effectiveMuted: e, scope: "workspace" });
    }
  } else {
    const subs = await driveDescendants(db, t.target.accountId, t.target.googleId);
    for (const s of subs) {
      const m = await isMuted(db, { scope: "drive", accountId: t.target.accountId, googleId: s.googleId });
      descendants.push({
        id: s.id, label: s.name, path: s.name, depth: 1, muted: m,
        effectiveMuted: m || await driveEffectiveMuted(db, t.target.accountId, s.googleId),
        scope: "drive", accountId: t.target.accountId, googleId: s.googleId,
      });
    }
  }
  return Response.json({
    ok: true, label: t.label, muted, effectiveMuted: effective, descendants,
  });
}

const Target = z.object({
  scope: z.enum(["workspace", "drive"]),
  id: z.string().uuid(),
  account: z.string().uuid().optional(),
});
const PostBody = z.object({
  target: Target,
  muted: z.boolean(),
  also: z.array(z.string().uuid()).max(500),
});

import { parseJson } from "@/lib/http";

// POST /api/folders/slack-mute — set the target's explicit mute + the
// explicitly-selected descendants. Every id is re-validated as a true,
// accessible descendant of the target; forged ids fail the whole request.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, PostBody);
  if (p.error) return p.error;
  const db = adminClient();
  const t = await resolveTarget(db, me, p.data.target.scope, p.data.target.id, p.data.target.account);
  if (!t.ok) return t.res;

  // Validate `also` against the true descendant set (no forged ids).
  const valid = new Set<string>();
  if (t.target.scope === "workspace") {
    for (const s of await workspaceDescendants(db, t.target.folderId)) valid.add(s.id);
  } else {
    for (const s of await driveDescendants(db, t.target.accountId, t.target.googleId)) valid.add(s.id);
  }
  for (const id of p.data.also) {
    if (!valid.has(id)) return Response.json({ error: "unknown folder in selection" }, { status: 400 });
  }
  // Accessibility re-check per selected descendant (target already checked).
  for (const id of p.data.also) {
    if (t.target.scope === "workspace") {
      const dst = await folderUsable(db, me, id);
      if (!dst.ok) return Response.json({ error: dst.reason ?? "not allowed" }, { status: 403 });
    } else {
      const { data } = await db.from("file_index")
        .select("id,owner,folder,google_file_id,google_parent_id,drive_account_id")
        .eq("id", id).eq("drive_account_id", t.target.accountId).maybeSingle();
      const row = (data ?? null) as {
        id: string; owner: string; folder: string | null;
        google_file_id: string | null; google_parent_id: string | null; drive_account_id: string | null;
      } | null;
      if (!row) return Response.json({ error: "unknown folder in selection" }, { status: 400 });
      const gate = await canTouch(db, me, { id: row.id, owner: row.owner ?? "", folder: row.folder }, googlePinOf(row));
      if (!gate.ok) return Response.json({ error: gate.reason ?? "not allowed" }, { status: 403 });
    }
  }

  const apply = async (target: { scope: "workspace"; folderId: string } | { scope: "drive"; accountId: string; googleId: string }, muted: boolean) => {
    if (target.scope === "workspace") {
      if (muted) {
        const { error } = await db.from("folder_slack_mutes").upsert(
          { workspace_folder_id: target.folderId, created_by: me.id },
          { onConflict: "workspace_folder_id", ignoreDuplicates: true }
        );
        if (error) throw new Error(error.message);
      } else {
        await db.from("folder_slack_mutes").delete().eq("workspace_folder_id", target.folderId);
      }
      return;
    }
    if (muted) {
      const { error } = await db.from("folder_slack_mutes").upsert(
        { drive_account_id: target.accountId, google_folder_id: target.googleId, created_by: me.id },
        { onConflict: "drive_account_id,google_folder_id", ignoreDuplicates: true }
      );
      if (error) throw new Error(error.message);
    } else {
      await db.from("folder_slack_mutes").delete()
        .eq("drive_account_id", target.accountId).eq("google_folder_id", target.googleId);
    }
  };

  const changed: string[] = [];
  try {
    await apply(t.target, p.data.muted);
    changed.push(t.label);
    for (const id of p.data.also) {
      if (t.target.scope === "workspace") {
        await apply({ scope: "workspace", folderId: id }, p.data.muted);
      } else {
        const { data } = await db.from("file_index").select("google_file_id")
          .eq("id", id).eq("drive_account_id", t.target.accountId).maybeSingle();
        const gid = ((data ?? {}) as { google_file_id?: string | null }).google_file_id;
        if (!gid) continue;
        await apply({ scope: "drive", accountId: t.target.accountId, googleId: gid }, p.data.muted);
      }
      changed.push(id);
    }
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "couldn't save" }, { status: 500 });
  }
  await logAudit({
    actor: me.id, actor_name: me.username, action: "edit", req,
    detail: { slack_muted: p.data.muted, folder: t.label, folders: changed.length },
  });
  return Response.json({ ok: true, muted: p.data.muted, changed: changed.length });
}
