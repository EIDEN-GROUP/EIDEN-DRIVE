import { createClient } from "@/lib/supabase-server";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { avatarUrlFor } from "@/lib/storage";
import UsersClient, { type DirectoryUser } from "@/components/users/UsersClient";

export const dynamic = "force-dynamic";

async function withAvatars<T extends { avatar_path?: string | null }>(rows: T[]): Promise<(Omit<T, "avatar_path"> & { avatarUrl: string | null })[]> {
  return Promise.all(rows.map(async (r) => {
    let avatarUrl: string | null = null;
    if (r.avatar_path) {
      avatarUrl = await avatarUrlFor(r.avatar_path);
    }
    const { avatar_path: _drop, ...rest } = r;
    return { ...rest, avatarUrl };
  }));
}

export default async function UsersPage() {
  const me = await getProfile();
  const supa = createClient();
  const { data } = await supa.from("profiles").select("id,username,role,department_tag,avatar_path").order("username").limit(200);
  const base = await withAvatars(((data ?? []) as { id: string; username: string; role: string; department_tag: string | null; avatar_path: string | null }[]));
  const depts = Array.from(new Set(base.map((r) => r.department_tag).filter(Boolean) as string[])).sort();

  // Managers/admins additionally see emails + join/last-active (service role, server-side only).
  let rows: DirectoryUser[] = base;
  const privileged = !!me && can(me.role, "manage-users") && hasAdminClient();
  if (privileged) {
    try {
      const { data: users } = await adminClient().auth.admin.listUsers();
      const byId = new Map((users?.users ?? []).map((u) => [u.id, u]));
      rows = base.map((p) => {
        const u = byId.get(p.id) as { email?: string; created_at?: string; last_sign_in_at?: string } | undefined;
        return { ...p, email: u?.email ?? null, created_at: u?.created_at ?? null, last_sign_in_at: u?.last_sign_in_at ?? null };
      });
    } catch { /* directory still renders without auth metadata */ }
  }

  const canInvite = !!me && can(me.role, "manage-users");
  const canManage = !!me && can(me.role, "assign-tag");
  const isAdmin = me?.role === "admin";

  return (
    <UsersClient rows={rows} me={me?.username ?? ""} isAdmin={isAdmin} canManage={canManage} canInvite={canInvite} depts={depts} />
  );
}
