import { createClient } from "@/lib/supabase-server";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import UsersClient, { type DirectoryUser } from "@/components/users/UsersClient";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await getProfile();
  const supa = createClient();
  const { data } = await supa.from("profiles").select("id,username,role,department_tag").order("username").limit(200);
  const base: DirectoryUser[] = ((data ?? []) as { id: string; username: string; role: string; department_tag: string | null }[]).map((r) => ({ ...r }));
  const depts = Array.from(new Set(base.map((r) => r.department_tag).filter(Boolean) as string[])).sort();

  // Managers/admins additionally see emails + join/last-active (service role, server-side only).
  let rows = base;
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
