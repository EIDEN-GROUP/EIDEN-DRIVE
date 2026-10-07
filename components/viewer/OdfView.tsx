"use client";
import { useEffect, useState } from "react";
import { escapeHtml, sanitizeHtml } from "./lib";

/** OpenDocument text / presentations (.odt .odp .ott .otp): headings, paragraphs and lists, in order. */
export default function OdfView({ bytes }: { bytes: ArrayBuffer }) {
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(bytes);
        const f = zip.files["content.xml"];
        if (!f) throw new Error("no content found");
        const doc = new DOMParser().parseFromString(await f.async("string"), "application/xml");
        const out: string[] = [];
        const walk = (el: Element) => {
          for (const c of Array.from(el.children)) {
            const n = c.localName;
            if (n === "h") out.push(`<h${Math.min(6, Number(c.getAttribute("text:outline-level")) || 2)}>${escapeHtml(c.textContent ?? "")}</h${Math.min(6, Number(c.getAttribute("text:outline-level")) || 2)}>`);
            else if (n === "p") { const t = c.textContent ?? ""; if (t.trim()) out.push(`<p>${escapeHtml(t)}</p>`); }
            else if (n === "list") { out.push("<ul>"); walk(c); out.push("</ul>"); }
            else if (n === "list-item") { out.push("<li>"); walk(c); out.push("</li>"); }
            else if (n === "page") out.push(`<hr/><p><em>Slide ${escapeHtml(c.getAttribute("draw:name") ?? "")}</em></p>`), walk(c);
            else if (n === "table-row") { out.push(`<p>${Array.from(c.children).map((x) => escapeHtml(x.textContent ?? "")).join(" | ")}</p>`); }
            else walk(c);
          }
        };
        const body = doc.getElementsByTagName("office:body")[0] ?? doc.documentElement;
        walk(body);
        if (!dead) setHtml(sanitizeHtml(out.join("")));
      } catch (e) { if (!dead) setErr(e instanceof Error ? e.message : "couldn't read this document"); }
    })();
    return () => { dead = true; };
  }, [bytes]);
  if (err) return <p className="p-8 text-center text-[14px] text-muted">This document couldn’t be read ({err}).</p>;
  if (html === null) return <div className="p-6 space-y-3" aria-label="Reading document"><div className="skel h-5 w-2/3" /><div className="skel h-4 w-full" /></div>;
  return (
    <div className="bg-soft min-h-full p-3 sm:p-6">
      <article className="md-body mx-auto max-w-[820px] bg-surface border border-line rounded-lg shadow-sm p-6 sm:p-12" dangerouslySetInnerHTML={{ __html: html || "<p><em>No text found.</em></p>" }} />
      <p className="text-center text-[11px] text-muted mt-3">Text view — formatting and images are not reproduced.</p>
    </div>
  );
}
