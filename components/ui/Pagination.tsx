"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { windowed } from "./pagination-utils";

export const DEFAULT_SIZES = [10, 25, 50, 100];

/** Client-side paging for an already-loaded list. Resets to page 1 when `resetKey` changes (filters, folder, sort…).
 *  The chosen page size is remembered per list (`storageKey`). */
export function usePagination<T>(items: T[], { defaultSize = 25, sizes = DEFAULT_SIZES, storageKey, resetKey }: { defaultSize?: number; sizes?: number[]; storageKey?: string; resetKey?: unknown } = {}) {
  const [size, setSizeState] = useState(defaultSize);
  const [page, setPage] = useState(1);
  useEffect(() => {
    if (!storageKey) return;
    try { const v = Number(localStorage.getItem(`eiden-pg-${storageKey}`)); if (sizes.includes(v)) setSizeState(v); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(page, pages);
  useEffect(() => { setPage(1); }, [resetKey, size]);
  const start = (current - 1) * size;
  const pageItems = useMemo(() => items.slice(start, start + size), [items, start, size]);
  const setSize = (n: number) => { setSizeState(n); try { if (storageKey) localStorage.setItem(`eiden-pg-${storageKey}`, String(n)); } catch { /* ignore */ } };
  return { page: current, pages, size, sizes, total: items.length, from: items.length ? start + 1 : 0, to: Math.min(start + size, items.length), pageItems, setPage, setSize };
}
export type PagerState = Pick<ReturnType<typeof usePagination>, "page" | "pages" | "size" | "sizes" | "total" | "from" | "to" | "setPage" | "setSize">;

/** Footer bar: rows per page · range · first / prev / numbered pages / next / last. Hidden when everything fits on one page. */
export default function Pagination({ pager, noun = "items", className = "" }: { pager: PagerState; noun?: string; className?: string }) {
  const { page, pages, size, sizes, total, from, to, setPage, setSize } = pager;
  if (total <= Math.min(...sizes)) return null;
  const btn = "size-9 grid place-items-center rounded-lg border border-line bg-surface text-ink/80 hover:bg-tint disabled:opacity-40 disabled:hover:bg-surface transition-colors";
  return (
    <nav aria-label={`${noun} pagination`} className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-1 py-3 text-[13px] ${className}`}>
      <label className="flex items-center gap-2 text-muted">
        Rows per page
        <select value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Rows per page"
          className="min-h-[36px] rounded-lg border border-line bg-surface px-2 text-ink focus:border-brand focus:outline-none">
          {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <span className="text-muted tabular-nums" aria-live="polite">{from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()} {noun}</span>
      <div className="flex items-center gap-1.5">
        <button className={btn} onClick={() => setPage(1)} disabled={page === 1} aria-label="First page"><ChevronsLeft size={15} /></button>
        <button className={btn} onClick={() => setPage(page - 1)} disabled={page === 1} aria-label="Previous page"><ChevronLeft size={15} /></button>
        {windowed(page, pages).map((n, i) => n === "…"
          ? <span key={`e${i}`} className="px-1 text-muted">…</span>
          : <button key={n} onClick={() => setPage(n)} aria-label={`Page ${n}`} aria-current={n === page ? "page" : undefined}
              className={`min-w-9 h-9 px-2 rounded-lg border tabular-nums transition-colors ${n === page ? "bg-brand text-white border-brand font-medium" : "border-line bg-surface hover:bg-tint"}`}>{n}</button>)}
        <button className={btn} onClick={() => setPage(page + 1)} disabled={page === pages} aria-label="Next page"><ChevronRight size={15} /></button>
        <button className={btn} onClick={() => setPage(pages)} disabled={page === pages} aria-label="Last page"><ChevronsRight size={15} /></button>
      </div>
    </nav>
  );
}
