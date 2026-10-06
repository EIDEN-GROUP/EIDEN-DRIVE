"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "../ui/Toast";
import ConfirmDialog from "../ui/ConfirmDialog";
import { Pill } from "../ui/primitives";

export interface Member {
  id: string;
  username: string;
  role: string;
  department_tag: string | null;
  email?: string | null;
  created_at?: string | null;
  last_sign_in_at?: string | null;
}

// One directory row. Members see it read-only; managers edit tags; admins edit
// roles and remove people. Every write goes through /api/users (server re-checks).
export default function MemberRow({ m, me, isAdmin, canManage, depts }: {
  m: Member; me: string; isAdmin: boolean; canManage: boolean; depts: string[];
}) {
  const router = useRouter();
  const [dept, setDept] = useState(m.department_tag ?? "");
  const [role, setRole] = useState(m.role);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const dirty = dept.trim() !== (m.department_tag ?? "") || role !== m.role;
  const isSelf = m.username === me;

  async function save() {
    setBusy(true);
    const r = await fetch("/api/users", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: m.id, department_tag: dept.trim() || null, ...(isAdmin && role !== m.role ? { role } : {}) })
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { toast({ text: d.error ?? "Couldn't save.", tone: "err" }); return; }
    toast({ text: `Saved ${m.username}.`, tone: "ok" });
    router.refresh();
  }

  async function remove() {
    const r = await fetch("/api/users", {
      method: "DELETE", headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: m.id })
    });
    const d = await r.json().catch(() => ({}));
    setConfirmRemove(false);
    if (!r.ok) { toast({ text: d.error ?? "Couldn't remove.", tone: "err" }); return; }
    toast({ text: `${m.username} removed.`, tone: "ok" });
    router.refresh();
  }

  return (
    <>
      <div className="grid grid-cols-[1fr_110px] md:grid-cols-[1fr_110px_1fr_auto] px-5 min-h-[56px] items-center gap-2 border-b border-line/70 last:border-0 text-[14px] py-2">
        <span className="flex items-center gap-3 min-w-0">
          <span className="size-8 rounded-full bg-tint text-brand grid place-items-center text-[13px] font-medium shrink-0" aria-hidden="true">
            {m.username.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="truncate block">{m.username}{isSelf && <span className="text-muted text-[12px]"> (you)</span>}</span>
            {m.email && <span className="truncate block text-[12px] text-muted">{m.email}</span>}
          </span>
        </span>
        <span>
          {isAdmin && !isSelf ? (
            <label className="sr-only" htmlFor={`role-${m.id}`}>Role for {m.username}</label>
          ) : null}
          {isAdmin && !isSelf ? (
            <select id={`role-${m.id}`} value={role} onChange={(e) => setRole(e.target.value)}
              className="min-h-[44px] rounded-md border border-line bg-surface text-[13px] px-1 max-w-[110px]">
              <option value="member">member</option>
              <option value="manager">manager</option>
              <option value="admin">admin</option>
            </select>
          ) : (
            <Pill tone={m.role === "member" ? "default" : "fill"}>{m.role}</Pill>
          )}
        </span>
        <span className="col-span-2 md:col-span-1">
          {canManage && !isSelf ? (
            <span className="flex items-center gap-2">
              <label className="sr-only" htmlFor={`dept-${m.id}`}>Department tag for {m.username}</label>
              <input id={`dept-${m.id}`} list="member-depts" value={dept} onChange={(e) => setDept(e.target.value)}
                maxLength={60} placeholder="—" className="min-h-[44px] flex-1 min-w-0 rounded-md border border-line bg-surface px-2 text-[13px]" />
              <datalist id="member-depts">{depts.map((d) => <option key={d} value={d} />)}</datalist>
            </span>
          ) : (
            <span className="text-[13px] text-ink/80">{m.department_tag ?? <span className="text-muted">--</span>}</span>
          )}
        </span>
        {canManage && !isSelf && (
          <span className="col-span-2 md:col-span-1 flex gap-2 justify-end">
            <button onClick={save} disabled={busy || !dirty}
              className="min-h-[44px] px-3 rounded-md bg-brand text-white text-[13px] font-medium disabled:opacity-40">
              {busy ? "Saving…" : "Save"}
            </button>
            {isAdmin && (
              <button onClick={() => setConfirmRemove(true)}
                className="min-h-[44px] px-3 rounded-md border border-danger/40 text-danger text-[13px]">
                Remove
              </button>
            )}
          </span>
        )}
      </div>
      <ConfirmDialog open={confirmRemove} title={`Remove ${m.username}?`}
        body="They lose access immediately and their profile is deleted. Their files stay in the drive."
        confirmLabel="Remove" onClose={() => setConfirmRemove(false)} onConfirm={remove} />
    </>
  );
}
