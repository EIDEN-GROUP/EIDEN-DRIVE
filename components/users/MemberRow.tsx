"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
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

// One directory row. Editing is explicit: an Edit button unlocks the fields,
// Save/Cancel commits or discards. Members see everything read-only; managers
// edit tags; admins edit roles and remove people. Every write goes through
// /api/users (server re-checks).
export default function MemberRow({ m, me, isAdmin, canManage, depts }: {
  m: Member; me: string; isAdmin: boolean; canManage: boolean; depts: string[];
}) {
  const router = useRouter();
  const [dept, setDept] = useState(m.department_tag ?? "");
  const [role, setRole] = useState(m.role);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const dirty = dept.trim() !== (m.department_tag ?? "") || role !== m.role;
  const isSelf = m.username === me;
  const canEdit = canManage && !isSelf;

  function startEdit() {
    setDept(m.department_tag ?? "");
    setRole(m.role);
    setEditing(true);
  }

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
    setEditing(false);
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
      <div className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_110px_1fr_auto] px-4 sm:px-5 min-h-[60px] items-center gap-x-3 gap-y-1 py-2 border-b border-line/70 last:border-0 text-[14px]">
        <span className="flex items-center gap-3 min-w-0">
          <span className="size-9 rounded-full bg-tint text-brand grid place-items-center text-[14px] font-medium shrink-0" aria-hidden="true">
            {m.username.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="truncate block font-medium">{m.username}{isSelf && <span className="text-muted font-normal text-[12px]"> (you)</span>}</span>
            {m.email && <span className="truncate block text-[12px] text-muted">{m.email}</span>}
            {m.last_sign_in_at && <span className="block text-[11px] text-muted">active {rel(m.last_sign_in_at)}</span>}
          </span>
        </span>
        <span className="hidden md:block">
          {editing && isAdmin && !isSelf ? (
            <span>
              <label className="sr-only" htmlFor={`role-${m.id}`}>Role for {m.username}</label>
              <select id={`role-${m.id}`} value={role} onChange={(e) => setRole(e.target.value)}
                className="min-h-[44px] rounded-md border border-line bg-surface text-[13px] px-1 max-w-[110px]">
                <option value="member">member</option>
                <option value="manager">manager</option>
                <option value="admin">admin</option>
              </select>
            </span>
          ) : (
            <Pill tone={m.role === "member" ? "default" : "fill"}>{m.role}</Pill>
          )}
        </span>
        <span className="col-span-2 md:col-span-1">
          {editing && canEdit ? (
            <span className="flex items-center gap-2">
              <label className="sr-only" htmlFor={`dept-${m.id}`}>Department tag for {m.username}</label>
              <input id={`dept-${m.id}`} list="member-depts" value={dept} onChange={(e) => setDept(e.target.value)}
                maxLength={60} placeholder="Department…" className="min-h-[44px] flex-1 min-w-0 rounded-md border border-line bg-surface px-2 text-[13px]" />
              <datalist id="member-depts">{depts.map((d) => <option key={d} value={d} />)}</datalist>
            </span>
          ) : (
            <span className="text-[13px] text-ink/80">{m.department_tag ?? <span className="text-muted">—</span>}</span>
          )}
        </span>
        <span className="col-start-2 row-start-1 md:col-start-auto md:row-start-auto flex gap-1.5 justify-end">
          {canEdit && !editing && (
            <button onClick={startEdit} aria-label={`Edit ${m.username}`}
              className="min-h-[44px] px-3 rounded-md border border-line text-[13px] flex items-center gap-1.5 hover:bg-tint">
              <Pencil size={14} /> <span className="hidden sm:inline">Edit</span>
            </button>
          )}
          {canEdit && editing && (
            <>
              <button onClick={() => setEditing(false)} aria-label="Cancel editing"
                className="size-11 grid place-items-center rounded-md border border-line hover:bg-tint"><X size={16} /></button>
              <button onClick={save} disabled={busy || !dirty}
                className="min-h-[44px] px-3 rounded-md bg-brand text-white text-[13px] font-medium disabled:opacity-40">
                {busy ? "Saving…" : "Save"}
              </button>
            </>
          )}
          {canEdit && isAdmin && !editing && (
            <button onClick={() => setConfirmRemove(true)} aria-label={`Remove ${m.username}`}
              className="min-h-[44px] px-3 rounded-md border border-danger/40 text-danger text-[13px]">
              Remove
            </button>
          )}
        </span>
      </div>
      <ConfirmDialog open={confirmRemove} title={`Remove ${m.username}?`}
        body="They lose access immediately and their profile is deleted. Their files stay in the drive."
        confirmLabel="Remove" onClose={() => setConfirmRemove(false)} onConfirm={remove} />
    </>
  );
}

function rel(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}
