export const dynamic = "force-dynamic";

import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { UPLOAD_BUCKET, PFP_BUCKET } from "@/lib/storage";
import { driveClient, resolveRoot } from "@/lib/google-drive";
import { getAccounts, quotaFor, rootKind, clientFor, type DriveAccount } from "@/lib/drive-accounts";
import { withTimeout, googleErrorMessage } from "@/lib/errors";

// Managers+: "check everything" in one call. Reports NAMES and booleans only —
// never secret values. Pinpoint which setup step is missing instead of guessing.
export async function GET() {
  const me = await getProfile();
  if (!me || !can(me.role, "manage-users")) return Response.json({ error: "managers only" }, { status: 403 });

  const google = {
    client_id: !!process.env.GOOGLE_CLIENT_ID,
    client_secret: !!process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: !!process.env.GOOGLE_REFRESH_TOKEN,
    shared_drive: !!process.env.GOOGLE_SHARED_DRIVE_ID,
    ready: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN)
  };

  // Does the session JWT resolve to the same user the profile claims?
  // A mismatch here is the classic cause of "row violates RLS" on every write.
  let identity: Record<string, unknown> = { match: null };
  try {
    const anon = createServerComponentClient({ cookies });
    const { data: { user } } = await anon.auth.getUser();
    identity = {
      auth_uid: user?.id ? `${user.id.slice(0, 8)}…` : null,
      profile_id: me.id ? `${me.id.slice(0, 8)}…` : null,
      match: !!user && user.id === me.id
    };
  } catch (e) {
    identity = { error: e instanceof Error ? e.message : "auth check failed" };
  }

  let storage: Record<string, unknown> = { configured: false };
  let agent: Record<string, unknown> = { heartbeat_min_ago: null, online: false };
  let sync: Record<string, unknown> = { last: null };
  if (hasAdminClient()) {
    const db = adminClient();
    const probe = await db.storage.from(UPLOAD_BUCKET).list("", { limit: 1 });
    const pfpProbe = await db.storage.from(PFP_BUCKET).list("", { limit: 1 });
    storage = {
      configured: !probe.error,
      bucket: UPLOAD_BUCKET,
      pfp_bucket: PFP_BUCKET,
      pfp_configured: !pfpProbe.error,
      ...(!probe.error ? {} : { hint: "Create a private bucket named eiden-uploads in Supabase → Storage." }),
      ...(pfpProbe.error ? { pfp_hint: "Create a private bucket named eiden-pfp in Supabase → Storage (or run 0017 + migrate-pfp)." } : {})
    };
    const { data: jobs } = await db.from("jobs").select("kind,status,created_at").order("created_at", { ascending: false }).limit(20);
    const hb = (jobs ?? []).find((j: { kind: string }) => j.kind === "agent-heartbeat") as { created_at: string } | undefined;
    const mins = hb ? Math.round((Date.now() - new Date(hb.created_at).getTime()) / 60000) : null;
    agent = { heartbeat_min_ago: mins, online: mins !== null && mins < 10 };
    const lastSync = (jobs ?? []).find((j: { kind: string }) => j.kind === "drive-sync" || (j.kind === "backup-verify")) as { created_at: string; status: string } | undefined;
    sync = { last: lastSync?.created_at ?? null, status: lastSync?.status ?? null };
  }

  // Live Google probe per connected account: token valid? Which Gmail? Root
  // kind? Free space? One dead account never hides the healthy ones.
  const drives: Record<string, unknown>[] = [];
  const accounts = await getAccounts() as (DriveAccount & { refresh_token: string })[];
  if (accounts.some((a) => a.status === "active")) {
    for (const a of accounts) {
      if (a.status !== "active") { drives.push({ label: a.label, reachable: false, cause: "disabled" }); continue; }
      try {
        const probed = await withTimeout(15_000, (async () => {
          const d = clientFor(a);
          if (!d) throw new Error("google not configured");
          const about = await d.about.get({ fields: "user(emailAddress)" });
          const kind = (await rootKind(d, a.root_id ?? "")).kind;
          const q = await quotaFor(a).catch(() => ({ usage: null, limit: null, free: null, email: a.email }));
          return { email: about.data.user?.emailAddress ?? a.email, kind, q };
        })(), `health probe ${a.label}`);
        drives.push({
          label: a.label, reachable: true, connected_as: probed.email,
          root: probed.kind, free: probed.q.free, limit: probed.q.limit
        });
      } catch (e) {
        const m = e instanceof Error ? e.message : "google probe failed";
        drives.push({
          label: a.label, reachable: false,
          cause: /invalid_grant/i.test(m) ? "refresh-token-rejected" : "unreachable",
          hint: googleErrorMessage(m)
        });
      }
    }
  } else if (google.ready) {
    // Legacy single-env connection (pre-migration).
    try {
      const g = driveClient();
      const about = await g!.about.get({ fields: "user(emailAddress,displayName)" });
      const email = about.data.user?.emailAddress ?? null;
      let root: unknown = "mydrive";
      try {
        root = (await resolveRoot()).root;
      } catch (e) {
        drives.push({ label: "Primary", reachable: false, connected_as: email, cause: "root-unresolvable", hint: e instanceof Error ? e.message : "root check failed" });
      }
      const kind = (root as { kind?: string })?.kind ?? "mydrive";
      drives.push({ label: "Primary", reachable: true, connected_as: email, root: kind });
    } catch (e) {
      const m = e instanceof Error ? e.message : "google probe failed";
      drives.push({
        label: "Primary", reachable: false,
        cause: /invalid_grant/i.test(m) ? "refresh-token-rejected" : "network-or-quota",
        hint: /invalid_grant/i.test(m)
          ? "Re-run /api/auth/google as admin (any Gmail works), save the new GOOGLE_REFRESH_TOKEN, redeploy."
          : m
      });
    }
  }

  const fix: string[] = [];
  if (!google.refresh_token && drives.length === 0) fix.push("Google sync: open /api/auth/google as admin to connect the first drive (docs/10).");
  for (const d of drives) {
    if (d.reachable === false) fix.push(`Google Drive "${d.label}": ${typeof d.hint === "string" ? d.hint : d.cause === "disabled" ? "account disabled" : "unreachable — see drives entry."}`);
  }
  if (identity.match === false) fix.push("Identity mismatch: your profiles.id differs from your auth user id — re-invite the account (delete + invite) so the trigger creates a matching profile.");
  if (storage.configured === false) fix.push("Uploads: create the private eiden-uploads bucket in Supabase → Storage.");
  if (!agent.online) fix.push("Agent: start local-agent on the office PC with the same AGENT_TOKEN.");

  return Response.json({ ok: fix.length === 0, google, drives, drive: drives[0] ?? null, identity, storage, agent, sync, fix });
}
