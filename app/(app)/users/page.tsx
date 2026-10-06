import { createClient } from "@/lib/supabase-server";
import { getProfile, can } from "@/lib/roles";
import { Pill } from "@/components/ui/primitives";
import InviteMember from "@/components/users/InviteMember";

export const dynamic = "force-dynamic";

interface Row { username: string; role: string; department_tag: string | null }

export default async function UsersPage() {
  const me = await getProfile();
  const supa = createClient();
  const { data } = await supa.from("profiles").select("username,role,department_tag").order("username").limit(200);
  const rows: Row[] = data ?? [];
  const depts = Array.from(new Set(rows.map((r) => r.department_tag).filter(Boolean) as string[])).sort();
  const canInvite = !!me && can(me.role, "manage-users");

  return (
    <section className="px-1 pt-1">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="page-title">Users & Departments</h1>
          <p className="text-sm text-muted mt-1">{rows.length} {rows.length === 1 ? "person" : "people"} · accounts are invite-only; tags are set by managers and admins.</p>
        </div>
        {canInvite && <InviteMember isAdmin={me?.role === "admin"} depts={depts} />}
      </div>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-[1fr_110px_1fr] px-5 h-10 items-center bg-head text-[13px] border-b border-line">
          <span>Name</span><span>Role</span><span>Department</span>
        </div>
        {rows.map((u) => (
          <div key={u.username} className="grid grid-cols-[1fr_110px_1fr] px-5 min-h-[48px] items-center border-b border-line/70 last:border-0 text-[14px]">
            <span className="flex items-center gap-3 min-w-0">
              <span className="size-8 rounded-full bg-tint text-brand grid place-items-center text-[13px] font-medium shrink-0">{u.username.slice(0, 1).toUpperCase()}</span>
              <span className="truncate">{u.username}{me?.username === u.username && <span className="text-muted text-[12px]"> (you)</span>}</span>
            </span>
            <span><Pill tone={u.role === "member" ? "default" : "fill"}>{u.role}</Pill></span>
            <span className="text-[13px] text-ink/80">{u.department_tag ?? <span className="text-muted">--</span>}</span>
          </div>
        ))}
        {rows.length === 0 && <p className="p-6 text-sm text-muted">No people yet. Invite the first member.</p>}
      </div>
    </section>
  );
}
