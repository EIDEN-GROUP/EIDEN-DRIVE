"use client";
import { useEffect, useRef, useState } from "react";
import { X, Save, Loader2 } from "lucide-react";
import { toast } from "../ui/Toast";
import { langOf, highlight } from "./filetext";
import type { ViewFile } from "./FileViewer";

// Plain-text editor with per-language highlighting behind a transparent
// textarea (VS Code-style read view, honest scope: no IntelliSense, no lint).
// Tab inserts two spaces, Ctrl/Cmd+S saves. Binary formats never reach here:
// the caller only offers Edit for editable() types and the API re-checks.
export default function FileEditor({ file, onClose, onSaved }: {
  file: ViewFile; onClose: () => void; onSaved: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await fetch(`/api/drive/download?file_id=${file.id}&raw=1`);
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error((d as { error?: string }).error ?? `couldn't load (${r.status})`);
        }
        const t = await r.text();
        if (!dead) setText(t);
      } catch (e) {
        if (!dead) setErr(e instanceof Error ? e.message : "Couldn't load file.");
      }
    })();
    return () => { dead = true; };
  }, [file.id]);

  function syncScroll() {
    if (taRef.current && preRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = taRef.current;
      if (!ta) return;
      const s = ta.selectionStart, en = ta.selectionEnd;
      const next = text!.slice(0, s) + "  " + text!.slice(en);
      setText(next);
      setDirty(true);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2; });
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); }
  }

  async function save() {
    if (text === null || saving) return;
    setSaving(true);
    const r = await fetch("/api/drive/content", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ file_id: file.id, text })
    });
    const d = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) { toast({ text: d.error ?? "Couldn't save.", tone: "err" }); return; }
    setDirty(false);
    toast({ text: `Saved ${file.name}.`, tone: "ok" });
    onSaved();
  }

  const lines = (text ?? "").split("\n").length;
  const html = (text ?? "").split("\n").map((l) => highlight(l) || " ").join("\n");

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={`Edit ${file.name}`}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="pop-in relative w-full max-w-4xl h-[84vh] rounded-xl bg-surface border border-line shadow-pop flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 min-h-[56px] border-b border-line">
          <p className="text-[14px] font-medium truncate flex-1">{file.name}{dirty && <span className="text-muted"> •</span>}</p>
          <span className="text-[11px] px-2 py-1 rounded bg-tint text-brand font-medium">{langOf(file.name)}</span>
          <button onClick={save} disabled={!dirty || saving || text === null}
            className="min-h-[40px] px-3 rounded-md bg-brand text-white text-[13px] font-medium disabled:opacity-40 flex items-center gap-1.5">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
          <button onClick={onClose} aria-label="Close editor" className="size-11 grid place-items-center rounded-md hover:bg-tint"><X size={18} /></button>
        </div>
        {err ? (
          <p className="p-8 text-center text-[14px]">{err}</p>
        ) : text === null ? (
          <div className="p-6 space-y-3" aria-label="Loading editor">
            <div className="skel h-4 w-full" /><div className="skel h-4 w-5/6" /><div className="skel h-4 w-4/6" />
          </div>
        ) : (
          <div className="editor-wrap flex-1 min-h-0">
            <pre ref={preRef} aria-hidden="true" className="editor-hl code-view"
              dangerouslySetInnerHTML={{ __html: html || " " }} />
            <textarea ref={taRef} value={text} spellCheck={false} autoCapitalize="off" autoCorrect="off"
              aria-label={`Edit ${file.name}`}
              onChange={(e) => { setText(e.target.value); setDirty(true); }}
              onScroll={syncScroll} onKeyDown={onKey} className="editor-ta" />
          </div>
        )}
        <div className="px-4 py-2 border-t border-line text-[11px] text-muted flex gap-4">
          <span>{lines} lines</span><span>{(text ?? "").length} chars</span><span>Ctrl+S to save</span>
        </div>
      </div>
    </div>
  );
}
