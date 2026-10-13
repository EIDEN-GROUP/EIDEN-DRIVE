export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { avatarUrlFor } from "@/lib/storage";
import { parseJson, dbError } from "@/lib/http";

// Managers/Admins: full directory incl. emails + sign-in info (auth data is
// service-role only — never exposed to members). Members use the page's
// RLS-safe profiles query instead.
export async function GET() {
  const me = await getProfile();
  if (!me || !can(me.role, "manage-users")) return Response.json({ error: "managers only" }, { status: 403 });
  if (!hasAdminClient()) return Response.json({ error: "server not configured" }, { status: 503 });
  const db = adminClient();
  const { data: profiles } = await db.from("profiles").select("id,username,role,department_tag,avatar_path").order("username").limit(200);
  // Slack links ride along when migration 0021 is applied; pre-migration the
  // directory still loads (linked status just reads "not linked" everywhere).
  let slackById = new Map<string, string | null>();
  try {
    const { data: links, error } = await db.from("profiles").select("id,slack_user_id").limit(500);
    if (!error && links) slackById = new Map(((links ?? []) as { id: string; slack_user_id: string | null }[]).map((r) => [r.id, r.slack_user_id]));
  } catch { /* pre-0021: no links */ }
  const { data: users } = await db.auth.admin.listUsers();
  const byId = new Map((users?.users ?? []).map((u) => [u.id, u]));
  const results = [];
  for (const p of (profiles ?? []) as { id: string; username: string; role: string; department_tag: string | null; avatar_path: string | null }[]) {
    const u = byId.get(p.id) as { email?: string; created_at?: string; last_sign_in_at?: string } | undefined;
    let avatarUrl: string | null = null;
    if (p.avatar_path) {
      avatarUrl = await avatarUrlFor(p.avatar_path);
    }
    results.push({ ...p, slack_user_id: slackById.get(p.id) ?? null, avatar_path: undefined, avatarUrl, email: u?.email ?? null, created_at: u?.created_at ?? null, last_sign_in_at: u?.last_sign_in_at ?? null });
  }
  return Response.json({ results });
}

const Update = z.object({
  user_id: z.string().uuid(),
  department_tag: z.string().max(60).nullable().optional(),
  role: z.enum(["admin", "manager", "member"]).optional(),
  // Admin-only fields (rejected for managers/members below, never silently
  // dropped — a non-admin smuggling one in must get a 403, not a partial save).
  username: z.string().max(60).optional(),
  slack_user_id: z.string().max(32).nullable().optional(),
}).refine((v) => v.department_tag !== undefined || v.role !== undefined || v.username !== undefined || v.slack_user_id !== undefined, { message: "nothing to update" });

// Username rules (same charset the invite flow mints): 1–60 chars after
// trimming, letters/digits plus . _ - only.
const USERNAME_RE = /^[A-Za-z0-9._-]{1,60}$/;
// Slack user IDs look like U012ABC34 (W… for enterprise apps, B… for bots):
// uppercase alphanumerics. Verified authoritatively via users.info when a bot
// token is configured; this shape check rejects typos before any API call.
const SLACK_ID_RE = /^[A-Z0-9]{9,20}$/;

// Manager/Admin: dept tags as before; role changes are Admin-only; username
// and Slack ID changes are Admin-only. Managers can never touch an Admin
// account. Writes use the service role AFTER these checks.
export async function PATCH(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "assign-tag")) return Response.json({ error: "managers only" }, { status: 403 });
  const p = await parseJson(req, Update);
  if (p.error) return p.error;
  const { user_id, department_tag, role } = p.data;

  const db = adminClient();
  const { data: target } = await db.from("profiles").select("id,role,username").eq("id", user_id).maybeSingle();
  if (!target) return Response.json({ error: "user not found" }, { status: 404 });
  if (target.role === "admin" && me.role !== "admin") return Response.json({ error: "only an admin can change an admin" }, { status: 403 });
  if (role && me.role !== "admin") return Response.json({ error: "only admin changes roles" }, { status: 403 });
  if (role && user_id === me.id && role !== "admin") return Response.json({ error: "admins cannot demote themselves" }, { status: 400 });

  // Username + Slack ID: admins only, validated before anything writes.
  let username: string | undefined;
  if (p.data.username !== undefined) {
    if (me.role !== "admin") return Response.json({ error: "only an admin can change usernames", code: "forbidden" }, { status: 403 });
    username = p.data.username.trim();
    if (!USERNAME_RE.test(username)) {
      return Response.json({ error: "usernames use 1–60 letters, digits, dots, underscores or dashes", code: "bad_username" }, { status: 400 });
    }
    const { data: clash } = await db.from("profiles").select("id").ilike("username", username).neq("id", user_id).limit(1);
    if (clash && (clash as unknown[]).length) {
      return Response.json({ error: "that username is already taken", code: "username_taken" }, { status: 409 });
    }
  }
  let slackId: string | null | undefined;
  if (p.data.slack_user_id !== undefined) {
    if (me.role !== "admin") return Response.json({ error: "only an admin can change Slack links", code: "forbidden" }, { status: 403 });
    if (p.data.slack_user_id === null || p.data.slack_user_id.trim() === "") {
      slackId = null; // clear the link
    } else {
      slackId = p.data.slack_user_id.trim().toUpperCase();
      if (!SLACK_ID_RE.test(slackId)) {
        return Response.json({ error: "Slack user IDs look like U012ABC34 (letters and digits)", code: "bad_slack_id" }, { status: 400 });
      }
      const { data: clash } = await db.from("profiles").select("id").eq("slack_user_id", slackId).neq("id", user_id).limit(1);
      if (clash && (clash as unknown[]).length) {
        return Response.json({ error: "that Slack account is already linked to another user", code: "slack_id_taken" }, { status: 409 });
      }
    }
  }

  const patch: Record<string, unknown> = {};
  if (department_tag !== undefined) patch.department_tag = department_tag;
  if (role) patch.role = role;
  if (username !== undefined) patch.username = username;
  if (slackId !== undefined) patch.slack_user_id = slackId;
  const { error } = await db.from("profiles").update(patch).eq("id", user_id);
  if (error) {
    // Unique-index backstop for check-then-write races (username or Slack ID).
    if (/duplicate|unique/i.test(error.message)) {
      return Response.json({ error: "that username or Slack link was just taken — retry", code: "conflict" }, { status: 409 });
    }
    // Pre-0021 schema has no slack_user_id column: name it instead of a raw DB error.
    if (slackId !== undefined && /slack_user_id|column/i.test(error.message)) {
      return Response.json({ error: "Slack linking isn't set up yet — apply migration 0021", code: "migration_missing" }, { status: 500 });
    }
    return dbError("Couldn't update the user.")(error);
  }
  const { data: updated } = await db.from("profiles").select("username,slack_user_id").eq("id", user_id).maybeSingle();
  await logAudit({
    actor: me.id, actor_name: me.username, action: "edit", req,
    detail: {
      users: user_id, ...patch,
      ...(username !== undefined ? { username_from: (target as { username: string }).username, username_to: username } : {}),
    },
  });
  return Response.json({ ok: true, username: (updated as { username?: string } | null)?.username ?? username ?? null, slack_user_id: (updated as { slack_user_id?: string | null } | null)?.slack_user_id ?? null });
}

const Remove = z.object({ user_id: z.string().uuid() });

// Admin-only: remove a member entirely. Guards: never yourself, never the last admin.
//
// WHY NOT JUST `delete from profiles`: nine tables reference profiles(id)
// with NO ACTION (file_index.owner, versions.actor, audit_logs.actor,
// recovery_bin.deleted_by, folder_bin.deleted_by, approvals.requester/
// approver, vault_items, vault_auth, notifications) — a bare delete dies with
// a FK violation (the old 500). And deleting the profile before the auth user
// risks a half-deleted account (profile gone, sign-in alive) that no retry
// could finish.
//
// Workflow (all service-role, audited at the end):
//   1. Detach, don't destroy: files keep their bytes (owner → NULL, managers
//      still see them); audit/version/bin/approval rows keep their history
//      (actor refs → NULL, actor_name text stays).
//   2. Personal data goes with the user: vault items (unopenable without
//      them), vault second-factor rows, notification inbox, avatar object.
//      Personal calendar plans + vault TOTP fall via ON DELETE CASCADE.
//   3. Delete the profile row, THEN the auth user (profiles.id references
//      auth.users — the reverse order violates the FK).
//   4. Recovery: profile already gone + auth user alive → finish the auth
//      delete and report recovered:true. Neither exists → 404. Re-running
//      prep is harmless (nulls stay null, deletes stay gone).
export async function DELETE(req: Request) {
  const me = await getProfile();
  if (!me || me.role !== "admin") return Response.json({ error: "admins only" }, { status: 403 });
  const p = await parseJson(req, Remove);
  if (p.error) return p.error;
  if (p.data.user_id === me.id) return Response.json({ error: "you cannot remove yourself" }, { status: 400 });

  const db = adminClient();
  const uid = p.data.user_id;
  const authGone = (m: string) => /not.?found|no user|does not exist/i.test(m);

  // Recovery path: a previous attempt removed the profile but died before
  // (or during) the auth delete. Finish the job instead of 404ing.
  const { data: target0 } = await db.from("profiles").select("id,role,username").eq("id", uid).maybeSingle();
  if (!target0) {
    const { error: retryErr } = await db.auth.admin.deleteUser(uid);
    if (retryErr && authGone(retryErr.message)) {
      return Response.json({ error: "user not found", code: "user_not_found" }, { status: 404 });
    }
    if (retryErr) {
      console.warn(`[user-remove] retry auth delete failed for ${uid}: ${retryErr.message}`);
      return Response.json({ error: "Couldn't remove the sign-in account — retry.", code: "user_auth_delete_failed" }, { status: 500 });
    }
    await logAudit({ actor: me.id, actor_name: me.username, action: "user-remove", req, detail: { users: uid, recovered: true } });
    return Response.json({ ok: true, recovered: true });
  }
  const target = target0 as { id: string; role: string; username: string };
  if (target.role === "admin") {
    const { count } = await db.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
    if ((count ?? 1) <= 1) return Response.json({ error: "cannot remove the last admin" }, { status: 400 });
  }

  // 1) Detach dependents. Capped loops (a long-lived user can own thousands
  // of rows); every step is re-runnable. Anything failing here aborts BEFORE
  // any row is deleted, so the account is untouched and retry is clean.
  const counts: Record<string, number> = {};
  try {
    const nullOut = async (table: string, col: string) => {
      let n = 0;
      for (let i = 0; i < 200; i++) {
        const { error, count } = await db.from(table).update({ [col]: null }, { count: "exact" }).eq(col, uid).limit(500);
        if (error) {
          // Forward-compat: folder_bin arrives with migration 0020 — a
          // deployment without it skips that table instead of failing the
          // whole deletion.
          if (/does not exist|could not find|schema cache/i.test(error.message)) {
            console.warn(`[user-remove] table ${table} missing, skipping (${uid})`);
            counts[`${table}.${col}_nulled`] = 0;
            return;
          }
          throw new Error(`${table}: ${error.message}`);
        }
        n += count ?? 0;
        if (!count) break;
      }
      counts[`${table}.${col}_nulled`] = n;
    };
    // Files stay (bytes in Drive/Storage untouched) — ownership detaches.
    await nullOut("file_index", "owner");
    // History stays readable — actor links detach, actor_name text remains.
    await nullOut("versions", "actor");
    await nullOut("audit_logs", "actor");
    await nullOut("recovery_bin", "deleted_by");
    await nullOut("folder_bin", "deleted_by");
    await nullOut("approvals", "requester");
    await nullOut("approvals", "approver");

    // 2) Personal data dies with the user (unopenable/unactionable without
    // them; keeping it would leak private data to nobody-administrable rows).
    const wipe = async (table: string, col: string) => {
      const { error, count } = await db.from(table).delete({ count: "exact" }).eq(col, uid);
      if (error) throw new Error(`${table}: ${error.message}`);
      counts[`${table}_removed`] = count ?? 0;
    };
    await wipe("vault_items", "owner");
    // created_by may differ from owner on shared-secret edge rows — catch both.
    {
      const { error, count } = await db.from("vault_items").delete({ count: "exact" }).eq("created_by", uid);
      if (error) throw new Error(`vault_items: ${error.message}`);
      counts["vault_items_removed"] += count ?? 0;
    }
    await wipe("vault_auth", "user_id");
    await wipe("notifications", "user_id");
    // (vault_totp + personal plans fall via ON DELETE CASCADE with the profile.)

    // Avatar object: personal, best-effort (a missing object is not a failure).
    const { data: prof } = await db.from("profiles").select("avatar_path").eq("id", uid).maybeSingle();
    const avatarPath = (prof as { avatar_path?: string | null } | null)?.avatar_path;
    if (avatarPath) {
      try {
        const { error: aErr } = await db.storage.from("eiden-pfp").remove([avatarPath]);
        if (aErr) throw new Error(aErr.message);
        counts["avatar_removed"] = 1;
      } catch (e) {
        console.warn(`[user-remove] avatar cleanup failed for ${uid}: ${e instanceof Error ? e.message : e}`);
      }
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : "preparation failed";
    console.warn(`[user-remove] prep failed for ${uid}: ${m}`);
    return Response.json({ error: "Couldn't prepare the account for removal — nothing was deleted, safe to retry.", code: "user_delete_prep_failed" }, { status: 500 });
  }

  // 3) Profile first (it references auth.users — reverse order violates it),
  // then the auth user. A missed FK here means a dependent was overlooked
  // above: fail loudly, never half-delete silently.
  const { error: pErr } = await db.from("profiles").delete().eq("id", uid);
  if (pErr) {
    console.warn(`[user-remove] profile delete failed for ${uid}: ${pErr.message}`);
    return Response.json({ error: "Couldn't remove the profile — a related record still references it. Report this.", code: "user_profile_delete_failed" }, { status: 500 });
  }
  const { error: uErr } = await db.auth.admin.deleteUser(uid);
  if (uErr && !authGone(uErr.message)) {
    // Profile is gone but sign-in survives: NOT silent — the retry path above
    // finishes it (recovered:true), and the client is told to retry.
    console.warn(`[user-remove] auth delete failed for ${uid}: ${uErr.message}`);
    await logAudit({ actor: me.id, actor_name: me.username, action: "user-remove", req, detail: { users: uid, username: target.username, partial: "auth-pending", ...counts } });
    return Response.json({ error: "Profile removed, but the sign-in account survived — retry to finish.", code: "user_auth_delete_failed" }, { status: 500 });
  }
  await logAudit({ actor: me.id, actor_name: me.username, action: "user-remove", req, detail: { users: uid, username: target.username, ...counts } });
  return Response.json({ ok: true, ...counts });
}
