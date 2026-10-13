import { createClient } from "@/lib/supabase-server";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { avatarUrlFor } from "@/lib/storage";
import { Card } from "@/components/ui/primitives";
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
  // Directory is administrators + managers only (unchanged contract).
  if (!me || !can(me.role, "manage-users")) {
    return (
      <section className="px-0 sm:px-1 pt-1 max-w-[1600px] mx-auto">
        <h1 className="page-title mb-4">All Users</h1>
        <Card label="Restricted">
          <p className="text-sm text-muted">The user directory is visible to admins and managers only.</p>
        </Card>
      </section>
    );
  }
  const supa = createClient();
  // slack_user_id rides along when migration 0021 is applied; pre-migration
  // the directory still loads (everyone reads "not linked").
  let rows0: { id: string; username: string; role: string; department_tag: string | null; avatar_path: string | null; slack_user_id?: string | null }[] = [];
  {
    const full = await supa.from("profiles").select("id,username,role,department_tag,avatar_path,slack_user_id").order("username").limit(200);
    if (!full.error) {
      rows0 = (full.data ?? []) as typeof rows0;
    } else {
      const { data } = await supa.from("profiles").select("id,username,role,department_tag,avatar_path").order("username").limit(200);
      rows0 = ((data ?? []) as typeof rows0).map((r) => ({ ...r, slack_user_id: null }));
    }
  }
  const base = await withAvatars(rows0);
  const depts = Array.from(new Set(base.map((r) => r.department_tag).filter(Boolean) as string[])).sort();

  // Managers/admins additionally see emails + join/last-active (service role, server-side only).
  let rows: DirectoryUser[] = base;
  const privileged = !!me && can(me.role, "manage-users") && hasAdminClient();
  if (privileged) {
    try {
      const { data: users } = await adminClient().auth.admin.listUsers();
      const byId = new Map((users?.users ?? []).map((u) => [u.id, u]));
      let linkById = new Map<string, { workspace_id: string; linked_at: string | null }>();
      try {
        const { data: links } = await adminClient().from("slack_links").select("eiden_user_id,workspace_id,linked_at").not("eiden_user_id", "is", null).limit(500);
        if (links) {
          for (const r of links as { eiden_user_id: string; workspace_id: string; linked_at: string | null }[]) {
            linkById.set(r.eiden_user_id, { workspace_id: r.workspace_id, linked_at: r.linked_at });
          }
        }
      } catch { /* pre-0022 */ }
      rows = base.map((p) => {
        const u = byId.get(p.id) as { email?: string; created_at?: string; last_sign_in_at?: string } | undefined;
        return { ...p, slack_link: linkById.get(p.id) ?? null, email: u?.email ?? null, created_at: u?.created_at ?? null, last_sign_in_at: u?.last_sign_in_at ?? null };
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
