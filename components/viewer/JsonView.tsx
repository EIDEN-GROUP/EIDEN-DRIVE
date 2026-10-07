"use client";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import TextView from "./TextView";

type J = string | number | boolean | null | J[] | { [k: string]: J };

function Node({ k, v, depth, open0 }: { k?: string; v: J; depth: number; open0: boolean }) {
  const [open, setOpen] = useState(open0);
  const isObj = v !== null && typeof v === "object";
  const key = k !== undefined ? <span className="text-brand">{JSON.stringify(k)}<span className="text-muted">: </span></span> : null;
  if (!isObj) {
    const cls = typeof v === "string" ? "text-[#0f7b6c]" : typeof v === "number" ? "text-[#c2410c]" : "text-[#7c3aed]";
    return <div className="pl-5 py-[1px] break-all">{key}<span className={cls}>{typeof v === "string" ? JSON.stringify(v) : String(v)}</span></div>;
  }
  const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : Object.entries(v);
  const [l, r] = Array.isArray(v) ? ["[", "]"] : ["{", "}"];
  return (
    <div className="py-[1px]">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-0.5 hover:bg-tint rounded -ml-0.5 pr-1" aria-expanded={open}>
        {open ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
        {key}<span className="text-muted">{l}{!open && ` ${entries.length} ${Array.isArray(v) ? "items" : "keys"} `}{!open && r}</span>
      </button>
      {open && (
        <div className="pl-4 ml-[6px] border-l border-line">
          {entries.slice(0, 500).map(([ek, ev]) => <Node key={ek} k={Array.isArray(v) ? undefined : ek} v={ev} depth={depth + 1} open0={depth < 1} />)}
          {entries.length > 500 && <p className="pl-5 text-muted">… {entries.length - 500} more</p>}
        </div>
      )}
      {open && <span className="text-muted pl-0.5">{r}</span>}
    </div>
  );
}

/** JSON: collapsible tree with a Raw/Pretty toggle. Invalid JSON falls back to the plain text with the parse error. */
export default function JsonView({ text }: { text: string }) {
  const parsed = useMemo(() => { try { return { ok: true as const, v: JSON.parse(text) as J }; } catch (e) { return { ok: false as const, err: e instanceof Error ? e.message : "invalid JSON" }; } }, [text]);
  const [mode, setMode] = useState<"tree" | "raw">("tree");
  const pretty = useMemo(() => (parsed.ok ? JSON.stringify(parsed.v, null, 2) : text), [parsed, text]);
  if (!parsed.ok) return <TextView text={text} note={`Not valid JSON (${parsed.err}) — showing it as plain text.`} />;
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-line text-[12.5px] shrink-0" role="tablist" aria-label="JSON view">
        {(["tree", "raw"] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
            className={`min-h-[36px] px-3 rounded-md capitalize ${mode === m ? "bg-tint text-brand font-medium" : "text-muted hover:bg-tint/60"}`}>{m === "raw" ? "Formatted text" : "Tree"}</button>
        ))}
      </div>
      {mode === "tree"
        ? <div className="flex-1 min-h-0 overflow-auto p-4 font-mono text-[12.5px] leading-6"><Node v={parsed.v} depth={0} open0 /></div>
        : <div className="flex-1 min-h-0"><TextView text={pretty} /></div>}
    </div>
  );
}
