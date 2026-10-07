"use client";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import Modal from "../ui/Modal";
import Select from "../ui/Select";
import { toast } from "../ui/Toast";
import { PRIORITY, type Plan, type Priority } from "./cal";

export interface Draft { id?: string; title: string; date: string; time: string; priority: Priority; folder: string; detail: string }

export function draftFrom(p: Plan): Draft {
  return { id: p.id, title: p.title, date: p.plan_date, time: p.plan_time ?? "", priority: (p.priority as Priority) in PRIORITY ? (p.priority as Priority) : "normal", folder: p.folder ?? "", detail: p.detail ?? "" };
}

/** Create / edit a plan. Same endpoints as before (/api/plans POST · PATCH · DELETE). */
export default function PlanModal({ draft, folders, onClose, onSaved }: {
  draft: Draft; folders: { id: string; name: string }[]; onClose: () => void; onSaved: () => void;
}) {
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const editing = !!d.id;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const field = "w-full min-h-[44px] mt-1 rounded-md border border-line bg-surface px-3 text-[14px] focus:border-brand focus:outline-none";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!d.title.trim()) return;
    setBusy(true); setErr("");
    const body = { title: d.title.trim(), detail: d.detail.trim() || null, plan_date: d.date, plan_time: d.time || null, priority: d.priority, folder: d.folder || null };
    const r = await fetch("/api/plans", {
      method: editing ? "PATCH" : "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(editing ? { id: d.id, ...body } : body)
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error ?? "Couldn't save the plan."); return; }
    toast({ text: editing ? "Plan updated." : "Plan added.", tone: "ok" });
    onSaved(); onClose();
  }
  async function remove() {
    setBusy(true);
    const r = await fetch("/api/plans", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: d.id }) });
    setBusy(false);
    if (!r.ok) { setErr("Couldn't delete the plan."); return; }
    toast({ text: "Plan deleted.", tone: "ok" });
    onSaved(); onClose();
  }

  return (
    <Modal open title={editing ? "Edit plan" : "New plan"} onClose={onClose} width={480} labelId="plan-title">
      <form onSubmit={save} className="flex flex-col gap-4">
        <div>
          <label htmlFor="pl-title" className="text-[13px] text-muted">Title</label>
          <input id="pl-title" autoFocus required maxLength={160} value={d.title} onChange={(e) => set("title", e.target.value)} className={field} placeholder="e.g. Review brand-book" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="pl-date" className="text-[13px] text-muted">Date</label>
            <input id="pl-date" type="date" required value={d.date} onChange={(e) => set("date", e.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor="pl-time" className="text-[13px] text-muted">Time <span className="text-muted/70">(optional)</span></label>
            <input id="pl-time" type="time" value={d.time} onChange={(e) => set("time", e.target.value)} className={field} />
          </div>
        </div>
        <fieldset>
          <legend className="text-[13px] text-muted mb-1">Priority</legend>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Priority">
            {(Object.keys(PRIORITY) as Priority[]).map((k) => {
              const on = d.priority === k, c = PRIORITY[k].color;
              return (
                <button key={k} type="button" role="radio" aria-checked={on} onClick={() => set("priority", k)}
                  className="min-h-[44px] rounded-md border text-[13.5px] flex items-center justify-center gap-2 transition-colors"
                  style={{ borderColor: on ? c : "var(--line)", background: on ? `color-mix(in srgb, ${c} 13%, var(--surface))` : "var(--surface)", fontWeight: on ? 500 : 400 }}>
                  <span className="size-2.5 rounded-full" style={{ background: c }} />{PRIORITY[k].label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div>
          <span id="pl-folder-l" className="text-[13px] text-muted">Linked folder <span className="text-muted/70">(optional)</span></span>
          <Select className="mt-1" label="Linked folder" value={d.folder} onChange={(v) => set("folder", v)} placeholder="No folder"
            options={[{ value: "", label: "No folder" }, ...folders.map((f) => ({ value: f.id, label: f.name }))]} />
        </div>
        <div>
          <label htmlFor="pl-detail" className="text-[13px] text-muted">Notes</label>
          <textarea id="pl-detail" rows={3} maxLength={2000} value={d.detail} onChange={(e) => set("detail", e.target.value)} className={`${field} py-2 resize-none`} placeholder="Optional" />
        </div>
        {err && <p className="text-[13px] text-danger" role="alert">{err}</p>}
        <div className="flex items-center gap-2 pt-1">
          {editing && (
            <button type="button" onClick={remove} disabled={busy} className="min-h-[44px] px-3 rounded-md text-danger text-[13.5px] flex items-center gap-1.5 hover:bg-danger/10 disabled:opacity-50">
              <Trash2 size={15} /> Delete
            </button>
          )}
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="min-h-[44px] px-4 rounded-md border border-line text-[13.5px] hover:bg-tint">Cancel</button>
          <button disabled={busy || !d.title.trim()} className="min-h-[44px] px-5 rounded-md bg-brand text-white text-[13.5px] font-medium disabled:opacity-50">
            {busy ? "Saving…" : editing ? "Save" : "Add plan"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
