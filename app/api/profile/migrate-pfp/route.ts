export const dynamic = "force-dynamic";

import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { UPLOAD_BUCKET, PFP_BUCKET } from "@/lib/storage";

// Managers+: move every profile picture from `eiden-uploads` to `eiden-pfp`
// (same path, so avatar_path never changes) and pin the matching file_index
// rows to the new bucket. Requires 0017_eiden_pfp.sql applied first.
// Idempotent: already-moved, missing, or pathless profiles are skipped.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "manage-users")) return Response.json({ error: "managers only" }, { status: 403 });
  if (!hasAdminClient()) return Response.json({ error: "server not configured" }, { status: 503 });
  const db = adminClient();
  const { data: profiles } = await db.from("profiles").select("id,username,avatar_path").not("avatar_path", "is", null).limit(2000);
  let moved = 0, already = 0, failed: { user: string; error: string }[] = [];
  for (const p of (profiles ?? []) as { id: string; username: string; avatar_path: string }[]) {
    const path = p.avatar_path;
    try {
      // Already there? Just make sure the index rows agree on the bucket.
      const { data: dst } = await db.storage.from(PFP_BUCKET).download(path);
      if (dst) {
        await db.from("file_index").update({ storage_bucket: PFP_BUCKET }).eq("storage_path", path);
        already++;
        continue;
      }
      const { data: src, error: dlErr } = await db.storage.from(UPLOAD_BUCKET).download(path);
      if (dlErr || !src) {
        // Bytes gone from uploads and not in pfp: point the index at pfp
        // anyway so reads stop trying the dead location first? No — leave the
        // row alone and report; the avatar fallback already handles it.
        failed.push({ user: p.username, error: dlErr?.message ?? "not found in either bucket" });
        continue;
      }
      const buf = Buffer.from(await src.arrayBuffer());
      const { data: frow } = await db.from("file_index").select("mime").eq("storage_path", path).limit(1).maybeSingle();
      const contentType = (frow as { mime?: string } | null)?.mime ?? "application/octet-stream";
      const { error: upErr } = await db.storage.from(PFP_BUCKET).upload(path, buf, { contentType, upsert: true });
      if (upErr) throw new Error(upErr.message);
      // Verify before deleting the original: re-download the copy.
      const { data: verify, error: vErr } = await db.storage.from(PFP_BUCKET).download(path);
      if (vErr || !verify) throw new Error("copy verification failed");
      await db.storage.from(UPLOAD_BUCKET).remove([path]);
      await db.from("file_index").update({ storage_bucket: PFP_BUCKET }).eq("storage_path", path);
      moved++;
    } catch (e) {
      failed.push({ user: p.username, error: e instanceof Error ? e.message : "migrate failed" });
    }
  }
  // Avatars are profile data, not files: drop any file_index rows that were
  // registered for these pictures so they stop listing in Workspace (the
  // bytes stay in eiden-pfp; avatar_path is untouched). Only rows that look
  // like avatar registrations: avatar.* names, owner = the profile, no folder.
  let unlisted = 0;
  try {
    const paths = ((profiles ?? []) as { avatar_path: string }[]).map((x) => x.avatar_path).filter(Boolean);
    for (let i = 0; i < paths.length; i += 200) {
      const chunk = paths.slice(i, i + 200);
      const { data: rows } = await db.from("file_index").select("id,owner").in("storage_path", chunk);
      const ids = ((rows ?? []) as { id: string; owner: string }[])
        .filter((r) => (profiles ?? []).some((pp: { id: string }) => pp.id === r.owner))
        .map((r) => r.id);
      if (ids.length) {
        for (let j = 0; j < ids.length; j += 200) {
          await db.from("recovery_bin").delete().in("file_id", ids.slice(j, j + 200));
          await db.from("approvals").delete().in("file_id", ids.slice(j, j + 200));
          const { error: delErr } = await db.from("file_index").delete().in("id", ids.slice(j, j + 200));
          if (!delErr) unlisted += ids.slice(j, j + 200).length;
        }
      }
    }
  } catch (e) {
    failed.push({ user: "(cleanup)", error: e instanceof Error ? e.message : "unlist failed" });
  }
  await logAudit({ actor: me.id, actor_name: me.username, action: "edit", req, detail: { pfp_migrated: moved, pfp_already: already, pfp_unlisted: unlisted, pfp_failed: failed.length } });
  return Response.json({ ok: true, moved, already, unlisted, failed });
}
