import { createClient } from "@/lib/supabase-server";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import InviteMember from "@/components/users/InviteMember";
import MemberRow, { type Member } from "@/components/users/MemberRow";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await getProfile();
  const supa = createClient();
  const { data } = await supa.from("profiles").select("id,username,role,department_tag").order("username").limit(200);
  const base: Member[] = (data ?? []).map((r: { id: string; username: string; role: string; department_tag: string | null }) => ({ ...r }));
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
    <section className="px-1 pt-1">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="page-title">Users & Departments</h1>
          <p className="text-sm text-muted mt-1">{rows.length} {rows.length === 1 ? "person" : "people"} · accounts are invite-only; tags are set by managers and admins.</p>
        </div>
        {canInvite && <InviteMember isAdmin={isAdmin} depts={depts} />}
      </div>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-[1fr_110px] md:grid-cols-[1fr_110px_1fr_auto] px-5 h-10 items-center bg-head text-[13px] border-b border-line font-medium">
          <span>Name</span><span>Role</span><span className="hidden md:inline">Department</span><span className="hidden md:inline"><span className="sr-only">Actions</span></span>
        </div>
        {rows.map((u) => (
          <MemberRow key={u.id} m={u} me={me?.username ?? ""} isAdmin={isAdmin} canManage={canManage} depts={depts} />
        ))}
        {rows.length === 0 && <p className="p-6 text-sm text-muted">No people yet. Invite the first member.</p>}
      </div>
    </section>
  );
}
