"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Pencil, Trash2, X, User as UserIcon } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import InviteMember from "@/components/users/InviteMember";
import Select from "@/components/ui/Select";
import Pagination, { usePagination } from "@/components/ui/Pagination";
import { Kpi, KpiRow, PageHead } from "@/components/dash/Dash";

export interface DirectoryUser {
  id: string; username: string; role: string; department_tag: string | null;
  email?: string | null; created_at?: string | null; last_sign_in_at?: string | null;
  avatarUrl?: string | null;
}

function Avatar({ u, size }: { u: { username: string; avatarUrl?: string | null }; size: string }) {
  if (u.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={u.avatarUrl} alt="" className={`${size} rounded-full object-cover shrink-0`} />;
  }
  return (
    <span className={`${size} rounded-full bg-tint text-brand grid place-items-center font-medium shrink-0`} aria-hidden="true">
      {u.username.slice(0, 1).toUpperCase()}
    </span>
  );
}

function rel(iso: string | null | undefined): string {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}
function activeSince(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < 30 * 24 * 3600_000;
}
function fullDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso);
  return isNaN(t.getTime()) ? "—" : t.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Directory: searchable, filterable table (department / role / status).
// Row click opens the user modal (Overview + Activity only).
export default function UsersClient({ rows, me, isAdmin, canManage, canInvite, depts }: {
  rows: DirectoryUser[]; me: string; isAdmin: boolean; canManage: boolean; canInvite: boolean; depts: string[];
}) {
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<DirectoryUser | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((u) => {
      if (needle && !`${u.username} ${u.email ?? ""}`.toLowerCase().includes(needle)) return false;
      if (dept && (u.department_tag ?? "") !== (dept === "__none" ? "" : dept)) return false;
      if (role && u.role !== role) return false;
      if (status === "active" && !activeSince(u.last_sign_in_at)) return false;
      if (status === "inactive" && activeSince(u.last_sign_in_at)) return false;
      return true;
    });
  }, [rows, q, dept, role, status]);

  const pager = usePagination(filtered, { defaultSize: 15, sizes: [10, 15, 25, 50], storageKey: "users", resetKey: `${q}|${dept}|${role}|${status}` });
  const input = "min-h-[44px] rounded-md border border-line bg-surface px-3 text-[13px] focus:border-brand focus:outline-none";

  return (
    <section className="px-1 pt-1">
      <PageHead title="All Users" subtitle="Accounts are invite-only; department tags are set by managers and admins."
        actions={canInvite ? <InviteMember isAdmin={isAdmin} depts={depts} /> : undefined} />

      <KpiRow>
        <Kpi label="People" value={rows.length} hint="with an account" />
        <Kpi label="Admins" value={rows.filter((u) => u.role === "admin").length} tone="brand" />
        <Kpi label="Managers" value={rows.filter((u) => u.role === "manager").length} />
        <Kpi label="Members" value={rows.filter((u) => u.role === "member").length} />
        <Kpi label="Active · 30 days" value={rows.filter((u) => activeSince(u.last_sign_in_at)).length} tone="good" hint="signed in recently" />
        <Kpi label="No department" value={rows.filter((u) => !u.department_tag).length} tone={rows.some((u) => !u.department_tag) ? "warn" : "default"} hint="untagged people" />
      </KpiRow>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2.5 mb-4">
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" aria-label="Search users" className={`${input} w-full pl-10`} />
        </div>
        <Select label="Filter by department" value={dept} onChange={setDept} placeholder="All departments"
          options={[{ value: "", label: "All departments" }, ...depts.map((d) => ({ value: d, label: d })), { value: "__none", label: "No department" }]} />
        <Select label="Filter by role" value={role} onChange={setRole} placeholder="All roles"
          options={[{ value: "", label: "All roles" }, { value: "admin", label: "Admin" }, { value: "manager", label: "Manager" }, { value: "member", label: "Member" }]} />
        <Select label="Filter by status" value={status} onChange={setStatus} placeholder="All statuses"
          options={[{ value: "", label: "All statuses" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} />
      </div>

      <div className="rounded-2xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px] min-w-[720px]">
            <thead>
              <tr className="bg-soft text-left text-[13.5px] text-ink/80 font-normal">
                <th className="px-4 h-11 font-medium">User</th>
                <th className="px-3 h-11 font-medium">Department</th>
                <th className="px-3 h-11 font-medium">Role</th>
                <th className="px-3 h-11 font-medium">Status</th>
                <th className="px-3 h-11 font-medium">Last Login</th>
                <th className="px-3 h-11"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {pager.pageItems.map((u) => {
                const on = activeSince(u.last_sign_in_at);
                return (
                  <tr key={u.id} onClick={() => setSelected(u)}
                    className="border-t border-line/70 first:border-0 hover:bg-tint/40 cursor-pointer transition-colors">
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2.5 min-w-0">
                        <Avatar u={u} size="size-9 text-[13px]" />
                        <span className="min-w-0">
                          <span className="block font-medium truncate">{u.username}{u.username === me && <span className="text-muted font-normal"> (you)</span>}</span>
                          {u.email && <span className="block text-[12px] text-muted truncate">{u.email}</span>}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {u.department_tag
                        ? <span className="inline-block px-2.5 py-1 rounded-md bg-tint text-brand text-[12px] font-medium">{u.department_tag}</span>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-block px-2.5 py-1 rounded-md bg-tint text-brand text-[12px] font-medium capitalize">{u.role}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 text-[12px] ${on ? "text-green-700" : "text-muted"}`} title={on ? "Signed in within the last 30 days" : "No sign-in in the last 30 days"}>
                        <span className={`size-1.5 rounded-full ${on ? "bg-green-600" : "bg-current"}`} />
                        {on ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-muted whitespace-nowrap">{rel(u.last_sign_in_at)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <UserRowActions u={u} me={me} isAdmin={isAdmin} canManage={canManage} depts={depts} onOpen={() => setSelected(u)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && <p className="p-6 text-sm text-muted text-center">No users match these filters.</p>}
        <div className="px-4 border-t border-line"><Pagination pager={pager} noun="people" /></div>
      </div>

      {selected && (
        <UserModal u={selected} me={me} isAdmin={isAdmin} canManage={canManage} depts={depts}
          onClose={() => setSelected(null)} />
      )}
    </section>
  );
}

function UserRowActions({ u, me, isAdmin, canManage, depts, onOpen }: {
  u: DirectoryUser; me: string; isAdmin: boolean; canManage: boolean; depts: string[]; onOpen: () => void;
}) {
  const router = useRouter();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const canEdit = canManage && u.username !== me;

  async function remove() {
    const r = await fetch("/api/users", {
      method: "DELETE", headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: u.id })
    });
    const d = await r.json().catch(() => ({}));
    setConfirmRemove(false);
    if (!r.ok) { toast({ text: d.error ?? "Couldn't remove.", tone: "err" }); return; }
    toast({ text: `${u.username} removed.`, tone: "ok" });
    router.refresh();
  }

  return (
    <span className="inline-flex gap-0.5">
      <button onClick={onOpen} aria-label={`Open ${u.username}`} title="Open"
        className="size-10 grid place-items-center rounded-md hover:bg-tint text-muted"><UserIcon size={16} /></button>
      {canEdit && (
        <button onClick={onOpen} aria-label={`Edit ${u.username}`} title="Edit"
          className="size-10 grid place-items-center rounded-md hover:bg-tint text-muted"><Pencil size={16} /></button>
      )}
      {canEdit && isAdmin && (
        <button onClick={() => setConfirmRemove(true)} aria-label={`Remove ${u.username}`} title="Remove"
          className="size-10 grid place-items-center rounded-md hover:bg-tint text-muted hover:text-danger"><Trash2 size={16} /></button>
      )}
      <ConfirmDialog open={confirmRemove} title={`Remove ${u.username}?`}
        body="They lose access immediately and their profile is deleted. Their files stay in the drive."
        confirmLabel="Remove" onClose={() => setConfirmRemove(false)} onConfirm={remove} />
    </span>
  );
}

function UserModal({ u, me, isAdmin, canManage, depts, onClose }: {
  u: DirectoryUser; me: string; isAdmin: boolean; canManage: boolean; depts: string[]; onClose: () => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"overview" | "activity">("overview");
  const [editing, setEditing] = useState(false);
  const [dept, setDept] = useState(u.department_tag ?? "");
  const [role, setRole] = useState(u.role);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [events, setEvents] = useState<{ id: number; action: string; ts: string; detail: Record<string, unknown> | null }[] | null>(null);
  const canEdit = canManage && u.username !== me;
  const on = activeSince(u.last_sign_in_at);

  useEffect(() => {
    if (tab !== "activity" || events !== null) return;
    let dead = false;
    fetch(`/api/activity?actor=${encodeURIComponent(u.username)}&limit=50`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })).catch(() => ({ ok: false, d: {} as { results?: [] } })))
      .then(({ ok, d }) => { if (!dead) setEvents(ok ? (d.results ?? []) : []); })
      .catch(() => { if (!dead) setEvents([]); });
    return () => { dead = true; };
  }, [tab, events, u.username]);

  async function save() {
    setBusy(true);
    const r = await fetch("/api/users", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: u.id, department_tag: dept.trim() || null, ...(isAdmin && role !== u.role ? { role } : {}) })
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { toast({ text: d.error ?? "Couldn't save.", tone: "err" }); return; }
    toast({ text: `Saved ${u.username}.`, tone: "ok" });
    setEditing(false);
    router.refresh();
    onClose();
  }

  async function remove() {
    const r = await fetch("/api/users", {
      method: "DELETE", headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: u.id })
    });
    const d = await r.json().catch(() => ({}));
    setConfirmRemove(false);
    if (!r.ok) { toast({ text: d.error ?? "Couldn't remove.", tone: "err" }); return; }
    toast({ text: `${u.username} removed.`, tone: "ok" });
    router.refresh();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={u.username}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="pop-in relative w-full max-w-lg max-h-[88vh] rounded-xl bg-surface border border-line shadow-pop flex flex-col overflow-hidden">
        <div className="p-5 pb-0">
          <div className="flex items-start gap-3">
            <Avatar u={u} size="size-12 text-[18px]" />
            <div className="min-w-0 flex-1">
              <p className="text-[17px] font-semibold truncate">{u.username}</p>
              {u.email && <p className="text-[12.5px] text-muted truncate">{u.email}</p>}
              <p className="mt-1.5 flex gap-1.5 flex-wrap">
                {u.department_tag && <span className="px-2 py-0.5 rounded-md bg-tint text-brand text-[11.5px] font-medium">{u.department_tag}</span>}
                <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[11.5px] font-medium capitalize border border-emerald-200">{u.role}</span>
              </p>
            </div>
            <span className={`inline-flex items-center gap-1.5 text-[12px] shrink-0 mt-1 ${on ? "text-green-700" : "text-muted"}`}>
              <span className={`size-1.5 rounded-full ${on ? "bg-green-600" : "bg-current"}`} />{on ? "Active" : "Inactive"}
            </span>
            <button onClick={onClose} aria-label="Close" className="size-10 grid place-items-center rounded-md hover:bg-tint shrink-0"><X size={17} /></button>
          </div>
          <div className="mt-4 grid grid-cols-3 text-center border-y border-line/70 py-3">
            <div><p className="text-[16px] font-semibold">{fullDate(u.created_at).split(",")[0]}</p><p className="text-[11px] text-muted">Member since</p></div>
            <div><p className="text-[16px] font-semibold capitalize">{u.role}</p><p className="text-[11px] text-muted">Role</p></div>
            <div><p className="text-[16px] font-semibold">{rel(u.last_sign_in_at)}</p><p className="text-[11px] text-muted">Last login</p></div>
          </div>
          <div role="tablist" aria-label="User sections" className="flex gap-4 mt-1">
            {(["overview", "activity"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={`min-h-[44px] text-[13.5px] capitalize border-b-2 -mb-px ${tab === t ? "border-brand text-brand font-medium" : "border-transparent text-muted hover:text-ink"}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-5 pt-4">
          {tab === "overview" && (
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <p className="text-[12px] font-medium text-muted mb-2">User Information</p>
                <dl className="text-[13px] space-y-2">
                  <div className="flex justify-between gap-2"><dt className="text-muted">Email</dt><dd className="truncate">{u.email ?? "—"}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted">User ID</dt><dd className="truncate font-mono text-[12px]" title={u.id}>{u.id.slice(0, 8)}…</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted">Created</dt><dd>{fullDate(u.created_at)}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted">Last Login</dt><dd>{fullDate(u.last_sign_in_at)}</dd></div>
                  <div className="flex justify-between gap-2 items-center"><dt className="text-muted">Department</dt>
                    <dd>{editing ? (
                      <input value={dept} onChange={(e) => setDept(e.target.value)} list="modal-depts" maxLength={60}
                        aria-label="Department" className="min-h-[40px] w-36 rounded-md border border-line bg-surface px-2 text-[13px]" />
                    ) : (u.department_tag ?? "—")}</dd>
                  </div>
                  <div className="flex justify-between gap-2 items-center"><dt className="text-muted">Role</dt>
                    <dd>{editing && isAdmin ? (
                      <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role"
                        className="min-h-[40px] rounded-md border border-line bg-surface px-1.5 text-[13px]">
                        <option value="member">member</option>
                        <option value="manager">manager</option>
                        <option value="admin">admin</option>
                      </select>
                    ) : <span className="capitalize">{u.role}</span>}</dd>
                  </div>
                </dl>
                <datalist id="modal-depts">{depts.map((d) => <option key={d} value={d} />)}</datalist>
              </div>
              <div>
                <p className="text-[12px] font-medium text-muted mb-2">Quick Actions</p>
                {canEdit && !editing && (
                  <button onClick={() => { setDept(u.department_tag ?? ""); setRole(u.role); setEditing(true); }}
                    className="w-full min-h-[44px] rounded-md bg-brand text-white text-[13px] font-medium flex items-center justify-center gap-1.5">
                    <Pencil size={14} /> Edit Profile
                  </button>
                )}
                {canEdit && editing && (
                  <div className="flex gap-2">
                    <button onClick={() => setEditing(false)} className="flex-1 min-h-[44px] rounded-md border border-line text-[13px]">Cancel</button>
                    <button onClick={save} disabled={busy} className="flex-1 min-h-[44px] rounded-md bg-brand text-white text-[13px] font-medium disabled:opacity-50">
                      {busy ? "Saving…" : "Save"}
                    </button>
                  </div>
                )}
                {!canEdit && <p className="text-[12.5px] text-muted">{u.username === me ? "This is you — ask another admin to change your role." : "You can't edit this account."}</p>}
                {canEdit && isAdmin && (
                  <button onClick={() => setConfirmRemove(true)}
                    className="mt-2 w-full min-h-[44px] rounded-md border border-danger/40 text-danger text-[13px] flex items-center justify-center gap-1.5">
                    <Trash2 size={14} /> Remove user
                  </button>
                )}
              </div>
            </div>
          )}
          {tab === "activity" && (
            <div>
              {events === null ? (
                <div className="space-y-2.5" aria-label="Loading user activity">
                  <div className="skel h-10 w-full" /><div className="skel h-10 w-full" />
                </div>
              ) : events.length === 0 ? (
                <p className="text-[13px] text-muted">No audited activity for {u.username} (or it isn't visible to you).</p>
              ) : (
                <ol className="relative border-l border-line ml-1.5">
                  {events.map((e: { id: number; action: string; ts: string; detail: Record<string, unknown> | null }) => (
                    <li key={e.id} className="relative pl-5 py-2 border-b border-line/50 last:border-0 text-[13px]">
                      <span className="absolute left-[-5px] top-[13px] size-2.5 rounded-full bg-brand ring-4 ring-surface" />
                      <span className="text-muted tabular-nums mr-2">{new Date(e.ts).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      {e.action}
                      {typeof e.detail?.name === "string" && <> · <span className="text-brand">{e.detail.name}</span></>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog open={confirmRemove} title={`Remove ${u.username}?`}
        body="They lose access immediately and their profile is deleted. Their files stay in the drive."
        confirmLabel="Remove" onClose={() => setConfirmRemove(false)} onConfirm={remove} />
    </div>
  );
}
