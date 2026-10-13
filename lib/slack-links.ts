import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { randomBytes } from "crypto";

// Slack ⇄ Eiden account linking (migration 0022). All reads/writes are
// service-role: link rows never leave the server except as UI status text.
// The admin-managed profiles.slack_user_id stays the canonical identity —
// the self-service flow may only SET it when unset (or identical), and may
// only CLEAR the exact id it linked. Anything else is an admin job.

export interface SlackLink {
  workspace_id: string;
  slack_user_id: string;
  eiden_user_id: string | null;
  linked_at: string | null;
  dismissed_at: string | null;
}

function db() { return adminClient(); }

/** Linked Eiden user for one Slack identity (null = unknown or dismissed). */
export async function linkedEidenUser(workspaceId: string, slackUserId: string): Promise<{ id: string } | null> {
  if (!hasAdminClient() || !workspaceId || !slackUserId) return null;
  try {
    const { data } = await db().from("slack_links")
      .select("eiden_user_id,linked_at").eq("workspace_id", workspaceId).eq("slack_user_id", slackUserId).maybeSingle();
    const row = (data ?? null) as { eiden_user_id: string | null; linked_at: string | null } | null;
    if (!row?.eiden_user_id || !row.linked_at) return null;
    return { id: row.eiden_user_id };
  } catch {
    return null;
  }
}

/** Full link row (for status display + dismissal checks). */
export async function slackLinkRow(workspaceId: string, slackUserId: string): Promise<SlackLink | null> {
  if (!hasAdminClient() || !workspaceId || !slackUserId) return null;
  try {
    const { data } = await db().from("slack_links").select("*").eq("workspace_id", workspaceId).eq("slack_user_id", slackUserId).maybeSingle();
    return (data ?? null) as SlackLink | null;
  } catch {
    return null;
  }
}

/** Has this Slack identity dismissed the connect prompt (and not linked since)? */
export async function promptDismissed(workspaceId: string, slackUserId: string): Promise<boolean> {
  const row = await slackLinkRow(workspaceId, slackUserId);
  return !!row && !row.eiden_user_id && !!row.dismissed_at;
}

export async function recordDismissal(workspaceId: string, slackUserId: string): Promise<void> {
  if (!hasAdminClient()) return;
  try {
    await db().from("slack_links").upsert(
      { workspace_id: workspaceId, slack_user_id: slackUserId, dismissed_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "workspace_id,slack_user_id" }
    );
  } catch (e) {
    console.warn(`[slack-link] dismissal not recorded: ${e instanceof Error ? e.message : e}`);
  }
}

const PAIRING_TTL_MS = 15 * 60_000;

/** Mint a single-use pairing token bound to one workspace + Slack user. */
export async function mintPairingToken(workspaceId: string, slackUserId: string): Promise<string | null> {
  if (!hasAdminClient()) return null;
  const token = `eiden_${randomBytes(24).toString("base64url")}`;
  try {
    const { error } = await db().from("slack_pairing").insert({
      token, workspace_id: workspaceId, slack_user_id: slackUserId,
      expires_at: new Date(Date.now() + PAIRING_TTL_MS).toISOString(),
    });
    if (error) return null;
    // Opportunistic expiry sweep (best-effort, never fails the mint).
    try { await db().from("slack_pairing").delete().lt("expires_at", new Date().toISOString()); } catch { /* ignore */ }
    return token;
  } catch {
    return null;
  }
}

export interface Pairing { workspace_id: string; slack_user_id: string }

/**
 * Consume a pairing token: single-use (marked atomically), unexpired, and
 * bound to the claimed workspace+user. Returns the binding or a safe reason.
 * Never trusts IDs from query params — the caller re-verifies them against
 * the Slack-signed payload that minted the token.
 */
export async function consumePairingToken(
  token: string, expectWorkspace: string, expectUser: string
): Promise<{ ok: true; pairing: Pairing } | { ok: false; error: string }> {
  if (!hasAdminClient() || !token) return { ok: false, error: "link expired — start over from Slack" };
  try {
    const { data } = await db().from("slack_pairing").select("workspace_id,slack_user_id,expires_at,used_at").eq("token", token).maybeSingle();
    const row = (data ?? null) as { workspace_id: string; slack_user_id: string; expires_at: string; used_at: string | null } | null;
    if (!row) return { ok: false, error: "link expired — start over from Slack" };
    if (row.used_at) return { ok: false, error: "link already used — start over from Slack" };
    if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, error: "link expired — start over from Slack" };
    if (row.workspace_id !== expectWorkspace || row.slack_user_id !== expectUser) {
      return { ok: false, error: "link doesn't match this Slack account — start over from Slack" };
    }
    // Atomic single-use: only the first consumer wins the NULL→now flip.
    const { data: claimed } = await db().from("slack_pairing")
      .update({ used_at: new Date().toISOString() }).eq("token", token).is("used_at", null).select("token");
    if (!claimed || !(claimed as unknown[]).length) return { ok: false, error: "link already used — start over from Slack" };
    return { ok: true, pairing: { workspace_id: row.workspace_id, slack_user_id: row.slack_user_id } };
  } catch {
    return { ok: false, error: "couldn't verify the link — retry" };
  }
}

/**
 * Bind one Eiden account to one Slack identity. Enforces: one Slack identity
 * ↔ one Eiden account per workspace (both directions). The admin-managed
 * profiles.slack_user_id may only be SET when unset (or identical) — an
 * admin-set different id is a conflict the user can't override.
 */
export async function bindSlackAccount(
  eidenUserId: string, workspaceId: string, slackUserId: string
): Promise<{ ok: true } | { ok: false; error: string; code: string }> {
  if (!hasAdminClient()) return { ok: false, error: "server not configured", code: "unconfigured" };
  const database = db();
  try {
    // Direction 1: this Slack identity already bound elsewhere?
    const { data: existing } = await database.from("slack_links")
      .select("eiden_user_id").eq("workspace_id", workspaceId).eq("slack_user_id", slackUserId).maybeSingle();
    const ex = (existing ?? null) as { eiden_user_id: string | null } | null;
    if (ex?.eiden_user_id && ex.eiden_user_id !== eidenUserId) {
      return { ok: false, error: "that Slack account is already linked to another Eiden account", code: "slack_taken" };
    }
    if (ex?.eiden_user_id === eidenUserId) return { ok: true }; // idempotent re-link
    // Direction 2: this Eiden account already bound to a different Slack id?
    const { data: mine } = await database.from("slack_links")
      .select("slack_user_id").eq("workspace_id", workspaceId).eq("eiden_user_id", eidenUserId).maybeSingle();
    const myRow = (mine ?? null) as { slack_user_id: string } | null;
    if (myRow && myRow.slack_user_id !== slackUserId) {
      return { ok: false, error: "this Eiden account is already linked to a different Slack user — disconnect it first", code: "eiden_taken" };
    }
    // Admin-managed identity: set only when unset (or identical).
    const { data: prof } = await database.from("profiles").select("slack_user_id").eq("id", eidenUserId).maybeSingle();
    const current = ((prof ?? {}) as { slack_user_id?: string | null }).slack_user_id ?? null;
    if (current && current !== slackUserId) {
      return { ok: false, error: "an admin set a different Slack ID on this account — ask them to clear it first", code: "admin_set" };
    }
    const now = new Date().toISOString();
    const { error: linkErr } = await database.from("slack_links").upsert(
      { workspace_id: workspaceId, slack_user_id: slackUserId, eiden_user_id: eidenUserId, linked_at: now, dismissed_at: null, updated_at: now },
      { onConflict: "workspace_id,slack_user_id" }
    );
    if (linkErr) {
      // Unique-violation race: someone bound the same identity concurrently.
      if (/duplicate|unique/i.test(linkErr.message)) {
        return { ok: false, error: "that Slack account was just linked elsewhere — retry", code: "slack_taken" };
      }
      return { ok: false, error: "couldn't save the link — retry", code: "db_error" };
    }
    if (!current) {
      const { error: profErr } = await database.from("profiles").update({ slack_user_id: slackUserId }).eq("id", eidenUserId);
      if (profErr) {
        // Roll back the link row so the two stay in agreement.
        try { await database.from("slack_links").delete().eq("workspace_id", workspaceId).eq("slack_user_id", slackUserId); } catch { /* ignore */ }
        if (/duplicate|unique/i.test(profErr.message)) {
          return { ok: false, error: "that Slack account is already linked to another user", code: "slack_taken" };
        }
        return { ok: false, error: "couldn't save the link — retry", code: "db_error" };
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: "couldn't save the link — retry", code: "db_error" };
  }
}

/** Disconnect: drop the workspace link; clear the profile id only if it matches. */
export async function unbindSlackAccount(
  eidenUserId: string, workspaceId: string, slackUserId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hasAdminClient()) return { ok: false, error: "server not configured" };
  const database = db();
  try {
    await database.from("slack_links").delete().eq("workspace_id", workspaceId).eq("slack_user_id", slackUserId);
    const { data: prof } = await database.from("profiles").select("slack_user_id").eq("id", eidenUserId).maybeSingle();
    if (((prof ?? {}) as { slack_user_id?: string | null }).slack_user_id === slackUserId) {
      await database.from("profiles").update({ slack_user_id: null }).eq("id", eidenUserId);
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "couldn't remove the link — retry" };
  }
}
