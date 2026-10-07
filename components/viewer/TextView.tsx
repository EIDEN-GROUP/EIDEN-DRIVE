"use client";
import { useEffect, useMemo, useState } from "react";
import { Copy, WrapText } from "lucide-react";
import { highlight } from "../drive/filetext";
import { toast } from "../ui/Toast";
import Pagination, { usePagination } from "../ui/Pagination";

/** Source / plain-text reader: line numbers, wrap toggle, find-in-file (jumps to the first match), copy. Long files are paged by lines. */
export default function TextView({ text, note }: { text: string; note?: string }) {
  const [wrap, setWrap] = useState(false);
  const [q, setQ] = useState("");
  const lines = useMemo(() => text.split("\n"), [text]);
  const needle = q.trim().toLowerCase();
  const hits = useMemo(() => (needle ? lines.reduce((n, l) => n + (l.toLowerCase().includes(needle) ? 1 : 0), 0) : 0), [lines, needle]);
  const pager = usePagination(lines, { defaultSize: 500, sizes: [200, 500, 1000, 2000], storageKey: "text", resetKey: text });
  const { setPage, size } = pager;
  useEffect(() => {
    if (!needle) return;
    const i = lines.findIndex((l) => l.toLowerCase().includes(needle));
    if (i >= 0) setPage(Math.floor(i / size) + 1);
  }, [needle, lines, size, setPage]);
  const html = useMemo(() => pager.pageItems.map((l, i) => {
    const hl = highlight(l) || "&nbsp;";
    const hit = needle && l.toLowerCase().includes(needle);
    return `<span class="cl${hit ? " cl-hit" : ""}"><span class="ln">${pager.from + i}</span><span class="lc">${hl}</span></span>`;
  }).join(""), [pager.pageItems, pager.from, needle]);

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
      <div className="shrink-0 border-t border-line px-3"><Pagination pager={pager} noun="lines" /></div>
    </div>
  );
}
