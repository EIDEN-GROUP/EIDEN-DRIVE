// Page-number window for the pagination bar: first, last, the current page ±1, with single ellipses between.
export function windowed(page: number, pages: number): (number | "…")[] {
  const out: (number | "…")[] = [];
  const add = (n: number | "…") => { if (out[out.length - 1] !== n) out.push(n); };
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1 || (page <= 3 && i <= 4) || (page >= pages - 2 && i >= pages - 3)) add(i);
    else add("…");
  }
  return out;
}
