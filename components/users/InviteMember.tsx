"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import Modal from "../ui/Modal";
import { toast } from "../ui/Toast";

export default function InviteMember({ isAdmin, depts }: { isAdmin: boolean; depts: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "manager" | "admin">("member");
  const [dept, setDept] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function close() { setOpen(false); setError(""); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const r = await fetch("/api/users/invite", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role, department_tag: dept.trim() || null })
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(d.error ?? "Couldn't send the invite."); return; }
    toast({ text: `Invite sent to ${d.email}.`, tone: "ok" });
    setEmail(""); setDept(""); setRole("member"); setOpen(false);
    router.refresh();
  }

  const field = "w-full min-h-[44px] mt-1 bg-transparent border-0 border-b border-[#8f8f9a] focus:border-b-2 focus:border-brand focus:outline-none rounded-none px-0 text-[16px]";
  return (
    <>
      <button onClick={() => setOpen(true)} className="min-h-[44px] px-4 rounded-md bg-brand text-white text-sm font-medium inline-flex items-center gap-2 hover:brightness-110">
        <UserPlus size={17} /> Invite member
      </button>
      <Modal open={open} title="Invite member" onClose={close} labelId="inv-title" width={440}>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <div>
            <label htmlFor="inv-email" className="block text-[13px] text-muted">Work email</label>
            <input id="inv-email" type="email" required autoFocus autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="inv-role" className="block text-[13px] text-muted">Role</label>
              <select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as typeof role)} disabled={!isAdmin} className={`${field} bg-surface`}>
                <option value="member">Member</option>
                {isAdmin && <option value="manager">Manager</option>}
                {isAdmin && <option value="admin">Admin</option>}
              </select>
            </div>
            <div>
              <label htmlFor="inv-dept" className="block text-[13px] text-muted">Department tag</label>
              <input id="inv-dept" list="inv-depts" maxLength={60} value={dept} onChange={(e) => setDept(e.target.value)} placeholder="optional" className={field} />
              <datalist id="inv-depts">{depts.map((d) => <option key={d} value={d} />)}</datalist>
            </div>
          </div>
          {!isAdmin && <p className="text-[12px] text-muted -mt-2">Managers can invite members. Only an admin can invite managers or admins.</p>}
          <p className="text-[12px] text-muted -mt-2">They get an email with a link that signs them in. Nobody can join without an invite.</p>
          {error && <p className="text-[13px] text-danger" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="min-h-[40px] px-4 rounded-md border border-line text-sm hover:bg-tint">Cancel</button>
            <button disabled={busy || !email} className="min-h-[40px] px-4 rounded-md bg-brand text-white text-sm font-medium disabled:opacity-50">{busy ? "Sending…" : "Send invite"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
