"use client";
import { useMemo, useState } from "react";
import { Copy, WrapText } from "lucide-react";
import { highlight } from "../drive/filetext";
import { toast } from "../ui/Toast";

/** Source / plain-text reader: line numbers, wrap toggle, find-in-file with match count, copy. */
export default function TextView({ text, note }: { text: string; note?: string }) {
  const [wrap, setWrap] = useState(false);
  const [q, setQ] = useState("");
  const lines = useMemo(() => text.split("\n"), [text]);
  const needle = q.trim().toLowerCase();
  const hits = useMemo(() => (needle ? lines.reduce((n, l) => n + (l.toLowerCase().includes(needle) ? 1 : 0), 0) : 0), [lines, needle]);
  const html = useMemo(() => {
    const MAX = 20_000; // keep the DOM sane; the rest is one click away via Download
    return lines.slice(0, MAX).map((l, i) => {
      const hl = highlight(l) || "&nbsp;";
      const hit = needle && l.toLowerCase().includes(needle);
      return `<span class="cl${hit ? " cl-hit" : ""}"><span class="ln">${i + 1}</span><span class="lc">${hl}</span></span>`;
    }).join("") + (lines.length > MAX ? `<span class="cl"><span class="ln"></span><span class="lc">… ${lines.length - MAX} more lines — download to read everything</span></span>` : "");
  }, [lines, needle]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line text-[12px] text-muted shrink-0">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find in file" aria-label="Find in file"
          className="min-h-[36px] w-44 rounded-md border border-line bg-surface px-2.5 text-[12.5px] text-ink focus:border-brand focus:outline-none" />
        {needle && <span className="tabular-nums">{hits} line{hits === 1 ? "" : "s"}</span>}
        <span className="flex-1" />
        <span className="tabular-nums">{lines.length.toLocaleString()} lines</span>
        <button onClick={() => setWrap((w) => !w)} aria-pressed={wrap} title="Wrap long lines"
          className={`min-h-[36px] px-2 rounded-md flex items-center gap-1 hover:bg-tint ${wrap ? "bg-tint text-brand" : ""}`}><WrapText size={14} /> Wrap</button>
        <button onClick={() => navigator.clipboard?.writeText(text).then(() => toast({ text: "Copied.", tone: "ok" }), () => toast({ text: "Couldn't copy.", tone: "err" }))}
          className="min-h-[36px] px-2 rounded-md flex items-center gap-1 hover:bg-tint"><Copy size={14} /> Copy</button>
      </div>
      {note && <p className="px-4 py-2 text-[12px] text-muted bg-soft border-b border-line shrink-0">{note}</p>}
      <pre className={`code-view flex-1 min-h-0 overflow-auto p-4 text-[12.5px] leading-6 ${wrap ? "whitespace-pre-wrap break-words" : ""}`} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
