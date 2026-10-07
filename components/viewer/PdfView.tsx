"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Minus, Plus, ScanLine } from "lucide-react";

// PDF.js v3 (pinned): pages are rendered lazily to canvas as they scroll into view. A "Text" tab gives
// selectable/searchable text per page (also works for copy-paste). If the worker can't load we fall back to
// the browser's own PDF frame so a PDF is never unreadable.
/* eslint-disable @typescript-eslint/no-explicit-any */
export default function PdfView({ bytes, fallbackUrl }: { bytes: ArrayBuffer; fallbackUrl?: string | null }) {
  const [doc, setDoc] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [needPw, setNeedPw] = useState<false | "first" | "wrong">(false);
  const [pw, setPw] = useState("");
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<"pages" | "text">("pages");
  const [page, setPage] = useState(1);
  const [text, setText] = useState<string[] | null>(null);
  const [q, setQ] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const lib = useRef<any>(null);

  const open = useCallback(async (password?: string) => {
    try {
      if (!lib.current) {
        const m: any = await import("pdfjs-dist/build/pdf");
        m.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.js";
        lib.current = m;
      }
      // pdf.js transfers the buffer to its worker — hand it a copy so we can retry (password) or fall back.
      const task = lib.current.getDocument({ data: new Uint8Array(bytes.slice(0)), password, isEvalSupported: false });
      setDoc(await task.promise); setNeedPw(false); setErr(null);
    } catch (e: any) {
      if (e?.name === "PasswordException") setNeedPw(e.code === 2 ? "wrong" : "first");
      else setErr(e?.message ?? "couldn't read this PDF");
    }
  }, [bytes]);
  useEffect(() => { open(); }, [open]);
  useEffect(() => () => { doc?.destroy?.(); }, [doc]);

  useEffect(() => {
    if (mode !== "text" || !doc || text) return;
    let dead = false;
    (async () => {
      const out: string[] = [];
      for (let i = 1; i <= Math.min(doc.numPages, 300); i++) {
        const p = await doc.getPage(i);
        const c = await p.getTextContent();
        out.push(c.items.map((x: any) => x.str + (x.hasEOL ? "\n" : "")).join(" ").replace(/ +\n/g, "\n"));
      }
      if (!dead) setText(out);
    })();
    return () => { dead = true; };
  }, [mode, doc, text]);

  if (needPw) {
    return (
      <form onSubmit={(e) => { e.preventDefault(); open(pw); }} className="p-8 max-w-sm mx-auto text-center">
        <p className="text-[14px]">{needPw === "wrong" ? "That password didn’t work." : "This PDF is password-protected."}</p>
        <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} aria-label="PDF password" placeholder="Password"
          className="mt-3 w-full min-h-[44px] rounded-md border border-line bg-surface px-3 focus:border-brand focus:outline-none" />
        <button className="mt-3 min-h-[44px] px-5 rounded-md bg-brand text-white text-sm font-medium">Open</button>
      </form>
    );
  }
  if (err) {
    return fallbackUrl
      ? <div className="h-full flex flex-col"><p className="px-4 py-2 text-[12px] text-muted bg-soft border-b border-line">Using the browser’s built-in PDF viewer.</p><iframe src={fallbackUrl} title="PDF" className="flex-1 w-full border-0" /></div>
      : <p className="p-8 text-center text-[14px] text-muted">This PDF couldn’t be read ({err}).</p>;
  }
  if (!doc) return <div className="p-6 space-y-3" aria-label="Opening PDF"><div className="skel h-5 w-1/3" /><div className="skel h-64 w-full" /></div>;

  const hits = q.trim() && text ? text.map((t, i) => (t.toLowerCase().includes(q.trim().toLowerCase()) ? i + 1 : 0)).filter(Boolean) : [];
  const jump = (n: number) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${n}"]`);
    el?.scrollIntoView({ block: "start" }); setPage(n);
  };
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-wrap items-center gap-1 px-3 py-2 border-b border-line shrink-0 text-[12.5px]">
        <div role="tablist" aria-label="PDF view" className="flex">
          {(["pages", "text"] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`min-h-[36px] px-3 rounded-md ${mode === m ? "bg-tint text-brand font-medium" : "text-muted hover:bg-tint/60"}`}>{m === "pages" ? "Pages" : "Text"}</button>
          ))}
        </div>
        {mode === "pages" ? (
          <>
            <span className="flex-1" />
            <label className="flex items-center gap-1 text-muted">Page
              <input type="number" min={1} max={doc.numPages} value={page} onChange={(e) => jump(Math.min(doc.numPages, Math.max(1, Number(e.target.value) || 1)))}
                aria-label="Page number" className="w-14 min-h-[36px] rounded-md border border-line bg-surface px-2 text-center text-ink tabular-nums" /> / {doc.numPages}
            </label>
            <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} aria-label="Zoom out" className="size-9 grid place-items-center rounded-md hover:bg-tint"><Minus size={15} /></button>
            <span className="w-11 text-center tabular-nums text-muted">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} aria-label="Zoom in" className="size-9 grid place-items-center rounded-md hover:bg-tint"><Plus size={15} /></button>
            <button onClick={() => setZoom(1)} aria-label="Reset zoom" title="Fit width" className="size-9 grid place-items-center rounded-md hover:bg-tint"><ScanLine size={15} /></button>
          </>
        ) : (
          <>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search text" aria-label="Search PDF text" className="ml-2 min-h-[36px] w-44 rounded-md border border-line bg-surface px-2.5 focus:border-brand focus:outline-none" />
            {q.trim() && text && <span className="text-muted tabular-nums">{hits.length} page{hits.length === 1 ? "" : "s"}</span>}
          </>
        )}
      </div>
      {mode === "pages" ? (
        <div ref={scroller} className="flex-1 min-h-0 overflow-auto bg-soft p-3 sm:p-5 space-y-3"
          onScroll={(e) => {
            const el = e.currentTarget; const top = el.getBoundingClientRect().top;
            const cur = Array.from(el.querySelectorAll<HTMLElement>("[data-page]")).find((n) => n.getBoundingClientRect().bottom > top + 80);
            if (cur) setPage(Number(cur.dataset.page));
          }}>
          {Array.from({ length: doc.numPages }, (_, i) => <PdfPage key={i} doc={doc} n={i + 1} zoom={zoom} root={scroller} />)}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-6 max-w-3xl mx-auto w-full">
          {!text ? <div className="space-y-2" aria-label="Extracting text"><div className="skel h-4 w-full" /><div className="skel h-4 w-5/6" /></div>
            : text.every((t) => !t.trim()) ? <p className="text-[14px] text-muted"><FileText size={16} className="inline mr-1" /> No text layer — this PDF is probably a scan (images only).</p>
            : text.map((t, i) => (!q.trim() || hits.includes(i + 1)) && (
              <section key={i} className="mb-6"><p className="text-[11px] text-muted mb-1">Page {i + 1}</p><p className="text-[14px] leading-relaxed whitespace-pre-wrap">{t || "(no text)"}</p></section>
            ))}
        </div>
      )}
    </div>
  );
}

function PdfPage({ doc, n, zoom, root }: { doc: any; n: number; zoom: number; root: React.RefObject<HTMLDivElement | null> }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let dead = false;
    doc.getPage(n).then((p: any) => {
      if (dead) return;
      const vp = p.getViewport({ scale: 1 });
      setSize({ w: vp.width, h: vp.height });
    });
    return () => { dead = true; };
  }, [doc, n]);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { root: root.current, rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);
  useEffect(() => {
    if (!visible || !size || !canvas.current || !wrap.current) return;
    let task: any, dead = false;
    (async () => {
      const p = await doc.getPage(n);
      const avail = (wrap.current!.parentElement?.clientWidth ?? 800) - 24;
      const fit = Math.min(avail / size.w, 2);
      const scale = fit * zoom;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = p.getViewport({ scale: scale * dpr });
      const c = canvas.current!;
      c.width = vp.width; c.height = vp.height;
      c.style.width = `${vp.width / dpr}px`; c.style.height = `${vp.height / dpr}px`;
      task = p.render({ canvasContext: c.getContext("2d")!, viewport: vp });
      try { await task.promise; } catch { /* cancelled by a newer render */ }
      if (dead) return;
    })();
    return () => { dead = true; task?.cancel?.(); };
  }, [visible, size, zoom, doc, n]);
  const avail = typeof window === "undefined" ? 800 : Math.min(window.innerWidth, 1000);
  return (
    <div ref={wrap} data-page={n} className="mx-auto bg-white shadow-sm border border-line w-fit" style={{ minHeight: size ? (size.h * Math.min((avail - 80) / size.w, 2) * zoom) : 400, minWidth: 200 }}>
      <canvas ref={canvas} aria-label={`Page ${n}`} className="block" />
    </div>
  );
}
