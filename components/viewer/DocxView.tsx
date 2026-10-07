"use client";
import { useEffect, useState } from "react";
import { sanitizeHtml } from "./lib";

/** Word (.docx): converted to semantic HTML in the browser (headings, lists, tables, images, links), then sanitised. */
export default function DocxView({ bytes }: { bytes: ArrayBuffer }) {
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const mammoth = (await import("mammoth/mammoth.browser")).default;
        const r = await mammoth.convertToHtml({ arrayBuffer: bytes });
        if (!dead) setHtml(sanitizeHtml(r.value));
      } catch (e) { if (!dead) setErr(e instanceof Error ? e.message : "couldn't read this document"); }
    })();
    return () => { dead = true; };
  }, [bytes]);
  if (err) return <p className="p-8 text-center text-[14px] text-muted">This Word file couldn’t be read ({err}). It may be password-protected or damaged.</p>;
  if (html === null) return <div className="p-6 space-y-3" aria-label="Reading document"><div className="skel h-5 w-2/3" /><div className="skel h-4 w-full" /><div className="skel h-4 w-5/6" /></div>;
  return (
    <div className="bg-soft min-h-full p-3 sm:p-6">
      <article className="md-body doc-page mx-auto max-w-[820px] bg-surface border border-line rounded-lg shadow-sm p-6 sm:p-12" dangerouslySetInnerHTML={{ __html: html || "<p><em>This document has no text.</em></p>" }} />
      <p className="text-center text-[11px] text-muted mt-3">Simplified rendering — fonts and page layout are not reproduced. Download for the original.</p>
    </div>
  );
}
