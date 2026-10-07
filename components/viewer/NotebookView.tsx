"use client";
import { useMemo } from "react";
import { marked } from "marked";
import { highlight } from "../drive/filetext";
import { escapeHtml, sanitizeHtml } from "./lib";

type Src = string | string[];
interface Out { output_type: string; text?: Src; name?: string; data?: Record<string, Src>; ename?: string; evalue?: string; traceback?: string[] }
interface Cell { cell_type: "markdown" | "code" | "raw"; source: Src; outputs?: Out[]; execution_count?: number | null }
const join = (s: Src | undefined) => (Array.isArray(s) ? s.join("") : s ?? "");
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

/** Jupyter notebook: markdown cells, highlighted code, and outputs (text, tables/HTML sanitised, PNG/JPEG plots, errors). */
export default function NotebookView({ text }: { text: string }) {
  const nb = useMemo(() => { try { return JSON.parse(text) as { cells?: Cell[]; metadata?: { kernelspec?: { display_name?: string } } }; } catch { return null; } }, [text]);
  if (!nb?.cells) return <p className="p-8 text-center text-[14px] text-muted">This notebook couldn’t be read (invalid .ipynb).</p>;
  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      {nb.metadata?.kernelspec?.display_name && <p className="text-[12px] text-muted">Kernel: {nb.metadata.kernelspec.display_name} · {nb.cells.length} cells</p>}
      {nb.cells.map((c, i) => {
        if (c.cell_type === "markdown") return <div key={i} className="md-body" dangerouslySetInnerHTML={{ __html: sanitizeHtml(marked.parse(join(c.source), { gfm: true, async: false }) as string) }} />;
        if (c.cell_type === "raw") return <pre key={i} className="text-[12.5px] whitespace-pre-wrap text-muted">{join(c.source)}</pre>;
        return (
          <div key={i} className="rounded-lg border border-line overflow-hidden">
            <div className="flex">
              <span className="w-14 shrink-0 text-right pr-2 pt-2 text-[11px] text-brand font-mono">[{c.execution_count ?? " "}]</span>
              <pre className="code-view flex-1 overflow-auto p-2 text-[12.5px] leading-6 bg-soft" dangerouslySetInnerHTML={{ __html: join(c.source).split("\n").map((l) => highlight(l) || "&nbsp;").join("\n") }} />
            </div>
            {(c.outputs ?? []).map((o, j) => {
              const d = o.data;
              if (d?.["image/png"] || d?.["image/jpeg"]) {
                const isPng = !!d["image/png"];
                return <div key={j} className="border-t border-line p-3 bg-white"><img alt="Notebook output" className="max-w-full" src={`data:image/${isPng ? "png" : "jpeg"};base64,${join(d[isPng ? "image/png" : "image/jpeg"]).replace(/\s/g, "")}`} /></div>;
              }
              if (d?.["text/html"]) return <div key={j} className="border-t border-line p-3 text-[12.5px] overflow-auto md-body" dangerouslySetInnerHTML={{ __html: sanitizeHtml(join(d["text/html"])) }} />;
              const t = o.output_type === "error" ? stripAnsi((o.traceback ?? [`${o.ename}: ${o.evalue}`]).join("\n")) : join(o.text ?? d?.["text/plain"]);
              return <pre key={j} className={`border-t border-line p-3 text-[12.5px] overflow-auto whitespace-pre-wrap ${o.output_type === "error" ? "text-danger bg-danger/5" : ""}`} dangerouslySetInnerHTML={{ __html: escapeHtml(t) }} />;
            })}
          </div>
        );
      })}
    </div>
  );
}
