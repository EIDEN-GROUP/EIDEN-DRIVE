"use client";
import { useEffect, useMemo, useState } from "react";

const MAX_ROWS = 2000, MAX_COLS = 60;
const colName = (i: number) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

/** Spreadsheets (xlsx · xlsm · xlsb · xls · ods · numbers): every sheet as a tab, values shown as formatted in the file. */
export default function SheetView({ bytes }: { bytes: ArrayBuffer }) {
  const [wb, setWb] = useState<{ names: string[]; sheets: Record<string, string[][]>; cut: Record<string, boolean> } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState("");
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const XLSX = await import("xlsx");
        const book = XLSX.read(new Uint8Array(bytes), { type: "array", cellDates: true, cellFormula: false, sheetRows: MAX_ROWS + 1 });
        const sheets: Record<string, string[][]> = {}; const cut: Record<string, boolean> = {};
        for (const n of book.SheetNames) {
          const rows = XLSX.utils.sheet_to_json<string[]>(book.Sheets[n], { header: 1, raw: false, defval: "", blankrows: false }) as string[][];
          cut[n] = rows.length > MAX_ROWS || rows.some((r) => r.length > MAX_COLS);
          sheets[n] = rows.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS).map((c) => String(c ?? "")));
        }
        if (!dead) setWb({ names: book.SheetNames, sheets, cut });
      } catch (e) { if (!dead) setErr(e instanceof Error ? e.message : "couldn't read this workbook"); }
    })();
    return () => { dead = true; };
  }, [bytes]);

  const name = wb?.names[tab];
  const rows = useMemo(() => {
    if (!wb || !name) return [];
    const n = q.trim().toLowerCase();
    const r = wb.sheets[name];
    return n ? r.filter((x) => x.some((c) => c.toLowerCase().includes(n))) : r;
  }, [wb, name, q]);
  const cols = Math.max(0, ...rows.slice(0, 300).map((r) => r.length));

  if (err) return <p className="p-8 text-center text-[14px] text-muted">This workbook couldn’t be read ({err}). It may be password-protected or damaged.</p>;
  if (!wb) return <div className="p-6 space-y-3" aria-label="Reading workbook"><div className="skel h-5 w-1/3" /><div className="skel h-40 w-full" /></div>;
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line shrink-0">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter rows" aria-label="Filter rows"
          className="min-h-[36px] w-44 rounded-md border border-line bg-surface px-2.5 text-[12.5px] focus:border-brand focus:outline-none" />
        <span className="flex-1" />
        <span className="text-[12px] text-muted tabular-nums">{rows.length.toLocaleString()} rows × {cols} cols</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {rows.length === 0 ? <p className="p-8 text-center text-[14px] text-muted">{q ? "No rows match." : "This sheet is empty."}</p> : (
          <table className="text-[12.5px] border-separate border-spacing-0 min-w-full">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="bg-head border-b border-line w-10 h-8" />
                {Array.from({ length: cols }, (_, c) => <th key={c} className="bg-head border-b border-l border-line px-3 h-8 text-center text-muted font-normal min-w-[88px]">{colName(c)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-tint/40">
                  <td className="bg-head/60 text-center text-muted tabular-nums border-b border-line/60 px-1 h-7">{i + 1}</td>
                  {Array.from({ length: cols }, (_, c) => <td key={c} className="px-3 h-7 border-b border-l border-line/60 max-w-[320px] truncate whitespace-nowrap" title={r[c]}>{r[c]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {wb.cut[name!] && <p className="p-3 text-center text-[12px] text-muted">Showing the first {MAX_ROWS.toLocaleString()} rows and {MAX_COLS} columns. Download for the full sheet.</p>}
      </div>
      <div role="tablist" aria-label="Sheets" className="flex gap-1 px-2 py-1.5 border-t border-line bg-soft overflow-x-auto shrink-0">
        {wb.names.map((n, i) => (
          <button key={n} role="tab" aria-selected={tab === i} onClick={() => { setTab(i); setQ(""); }}
            className={`min-h-[36px] px-3 rounded-md text-[12.5px] whitespace-nowrap ${tab === i ? "bg-surface border border-line text-brand font-medium" : "text-muted hover:bg-tint"}`}>{n}</button>
        ))}
      </div>
    </div>
  );
}
