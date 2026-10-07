"use client";
import { useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import Modal from "../ui/Modal";
import { SWATCHES, type Tag, type TagKind, type TagsApi } from "./useTags";

/** Small coloured dot (a11y: always paired with the tag name somewhere, or given a title). */
export function TagDot({ tag, size = 10 }: { tag: Tag; size?: number }) {
  return <span className="inline-block rounded-full shrink-0" style={{ width: size, height: size, background: tag.color }} title={tag.name} />;
}

/** Row cell: up to 3 dots + "+N". */
export function TagDots({ tags }: { tags: Tag[] }) {
  if (!tags.length) return <span className="text-[11px] text-muted">--</span>;
  return (
    <span className="inline-flex items-center gap-1" aria-label={tags.map((t) => t.name).join(", ")}>
      {tags.slice(0, 3).map((t) => <TagDot key={t.id} tag={t} />)}
      {tags.length > 3 && <span className="text-[10px] text-muted">+{tags.length - 3}</span>}
    </span>
  );
}

export function TagChip({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 pl-2 pr-1.5 py-0.5 rounded-full text-[11.5px] font-medium"
      style={{ background: `color-mix(in srgb, ${tag.color} 14%, var(--surface))`, color: `color-mix(in srgb, ${tag.color} 78%, var(--ink))`, border: `1px solid color-mix(in srgb, ${tag.color} 35%, transparent)` }}>
      <span className="size-1.5 rounded-full" style={{ background: tag.color }} />{tag.name}
      {onRemove && <button onClick={onRemove} aria-label={`Remove tag ${tag.name}`} className="size-4 grid place-items-center rounded-full hover:bg-black/10"><X size={11} /></button>}
    </span>
  );
}

function Swatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Tag colour">
      {SWATCHES.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} onClick={() => onChange(c)}
          className="size-8 rounded-full grid place-items-center ring-offset-2 ring-offset-surface transition-shadow" style={{ background: c, boxShadow: value === c ? `0 0 0 2px ${c}` : undefined }}>
          {value === c && <Check size={15} className="text-white" strokeWidth={3} />}
        </button>
      ))}
    </div>
  );
}

/** Create or edit a tag (name + colour with a live preview). */
export function TagEditor({ tag, api, onClose }: { tag?: Tag; api: TagsApi; onClose: () => void }) {
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState(tag?.color ?? SWATCHES[(api.tags.length * 3 + 6) % SWATCHES.length]);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const ok = tag ? await api.update(tag.id, { name: name.trim(), color }) : !!(await api.create(name.trim(), color));
    setBusy(false);
    if (ok) onClose();
  }
  return (
    <Modal open title={tag ? "Edit tag" : "New tag"} onClose={onClose} width={400} labelId="tag-ed">
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div>
          <label htmlFor="tag-name" className="text-[13px] text-muted">Name</label>
          <input id="tag-name" autoFocus maxLength={32} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Invoices"
            className="w-full min-h-[44px] mt-1 rounded-md border border-line bg-surface px-3 text-[14px] focus:border-brand focus:outline-none" />
        </div>
        <div><span className="text-[13px] text-muted block mb-2">Colour</span><Swatches value={color} onChange={setColor} /></div>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-muted">Preview</span>
          <TagChip tag={{ id: "x", name: name.trim() || "Tag name", color, created_by: null }} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[44px] px-4 rounded-md border border-line text-[13.5px] hover:bg-tint">Cancel</button>
          <button disabled={busy || !name.trim()} className="min-h-[44px] px-5 rounded-md bg-brand text-white text-[13.5px] font-medium disabled:opacity-50">{busy ? "Saving…" : tag ? "Save" : "Create tag"}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Attach / detach tags on one file or folder; type a new name + Enter to create-and-attach in one step. */
export function TagPicker({ target, api, onClose }: { target: { kind: TagKind; id: string; name: string }; api: TagsApi; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const have = new Set(api.idsOf(target.kind, target.id));
  const needle = q.trim().toLowerCase();
  const list = useMemo(() => api.tags.filter((t) => !needle || t.name.toLowerCase().includes(needle)), [api.tags, needle]);
  const exact = api.tags.some((t) => t.name.toLowerCase() === needle);

  async function createAndAttach() {
    const name = q.trim();
    if (!name || exact) return;
    setBusy(true);
    const t = await api.create(name, SWATCHES[(api.tags.length * 3 + 6) % SWATCHES.length]);
    if (t) { await api.assign(target.kind, target.id, t.id, true); setQ(""); }
    setBusy(false);
  }
  return (
    <Modal open title="Tags" onClose={onClose} width={420} labelId="tag-pick">
      <p className="text-[12.5px] text-muted -mt-1 mb-3 truncate">For “{target.name}”</p>
      <form onSubmit={(e) => { e.preventDefault(); if (list.length === 1 && !exact) api.assign(target.kind, target.id, list[0].id, !have.has(list[0].id)); else createAndAttach(); }}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} maxLength={32} placeholder="Find a tag or type a new name…" aria-label="Find or create a tag"
          className="w-full min-h-[44px] rounded-md border border-line bg-surface px-3 text-[14px] focus:border-brand focus:outline-none" />
      </form>
      <ul className="mt-3 max-h-[280px] overflow-auto -mx-1" role="listbox" aria-label="Tags" aria-multiselectable="true">
        {list.map((t) => {
          const on = have.has(t.id);
          return (
            <li key={t.id} role="option" aria-selected={on}>
              <button onClick={() => api.assign(target.kind, target.id, t.id, !on)}
                className="w-full min-h-[44px] px-2 rounded-md flex items-center gap-3 text-left hover:bg-tint transition-colors">
                <span className={`size-5 rounded border grid place-items-center shrink-0 ${on ? "border-transparent" : "border-line"}`} style={{ background: on ? t.color : undefined }}>
                  {on && <Check size={13} className="text-white" strokeWidth={3} />}
                </span>
                <span className="flex-1 truncate text-[14px]">{t.name}</span>
                <span className="text-[11px] text-muted tabular-nums">{api.counts.get(t.id) ?? 0}</span>
              </button>
            </li>
          );
        })}
        {list.length === 0 && !needle && <li className="px-2 py-6 text-center text-[13px] text-muted">No tags yet. Type a name above to create the first one.</li>}
      </ul>
      {needle && !exact && (
        <button onClick={createAndAttach} disabled={busy}
          className="mt-2 w-full min-h-[44px] rounded-md bg-tint text-brand text-[13.5px] font-medium flex items-center justify-center gap-1.5 hover:brightness-95 disabled:opacity-50">
          <Plus size={16} /> Create “{q.trim()}” and add
        </button>
      )}
      <div className="mt-4 flex justify-end"><button onClick={onClose} className="min-h-[44px] px-5 rounded-md bg-brand text-white text-[13.5px] font-medium">Done</button></div>
    </Modal>
  );
}
