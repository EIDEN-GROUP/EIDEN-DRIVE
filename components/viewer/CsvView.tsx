"use client";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { detectDelimiter, parseCsv } from "./lib";
import Pagination, { usePagination } from "../ui/Pagination";


/** CSV / TSV as a real table: sticky header, row numbers, sort, filter, delimiter auto-detected. */
export default function CsvView({ text }: { text: string }) {
  const delim = useMemo(() => detectDelimiter(text), [text]);
  const rows = useMemo(() => parseCsv(text, delim), [text, delim]);
  const [header, setHeader] = useState(true);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const head = header && rows.length ? rows[0] : null;
  const body = header ? rows.slice(1) : rows;
  const cols = Math.max(0, ...rows.slice(0, 200).map((r) => r.length));
  const view = useMemo(() => {
    const n = q.trim().toLowerCase();
    let r = n ? body.filter((x) => x.some((c) => c.toLowerCase().includes(n))) : body;
    if (sort) {
      const { col, dir } = sort;
      r = [...r].sort((a, b) => {
        const x = a[col] ?? "", y = b[col] ?? "";
        const nx = Number(x.replace(/[, ]/g, "")), ny = Number(y.replace(/[, ]/g, ""));
        return (Number.isFinite(nx) && Number.isFinite(ny) && x !== "" && y !== "" ? nx - ny : x.localeCompare(y)) * dir;
      });
    }
    return r;
  }, [body, q, sort]);

  const pager = usePagination(view, { defaultSize: 100, sizes: [50, 100, 250, 500], storageKey: "csv", resetKey: `${q}|${sort?.col}|${sort?.dir}|${header}` });
  if (!rows.length) return <p className="p-8 text-center text-[14px] text-muted">This file is empty.</p>;
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line text-[12px] text-muted shrink-0">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter rows" aria-label="Filter rows"
          className="min-h-[36px] w-44 rounded-md border border-line bg-surface px-2.5 text-[12.5px] text-ink focus:border-brand focus:outline-none" />
        <label className="flex items-center gap-1.5 min-h-[36px] cursor-pointer"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} className="accent-brand" /> First row is a header</label>
        <span className="flex-1" />
        <span className="tabular-nums">{view.length.toLocaleString()} row{view.length === 1 ? "" : "s"} × {cols} col{cols === 1 ? "" : "s"} · delimiter “{delim === "\t" ? "tab" : delim}”</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="text-[12.5px] border-separate border-spacing-0 min-w-full">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="bg-head border-b border-line px-2 h-9 text-right text-muted font-normal w-12">#</th>
              {Array.from({ length: cols }, (_, c) => (
                <th key={c} className="bg-head border-b border-l border-line px-3 h-9 text-left font-medium whitespace-nowrap">
                  <button onClick={() => setSort((s) => (s?.col === c ? (s.dir === 1 ? { col: c, dir: -1 } : null) : { col: c, dir: 1 }))} className="inline-flex items-center gap-1 hover:text-brand">
                    {head?.[c] || `Column ${c + 1}`}{sort?.col === c && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pager.pageItems.map((r, i) => (
              <tr key={i} className="hover:bg-tint/40">
                <td className="px-2 h-8 text-right text-muted tabular-nums border-b border-line/60">{pager.from + i}</td>
                {Array.from({ length: cols }, (_, c) => <td key={c} className="px-3 h-8 border-b border-l border-line/60 max-w-[360px] truncate" title={r[c]}>{r[c]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="shrink-0 border-t border-line px-3"><Pagination pager={pager} noun="rows" /></div>
    </div>
  );
}
