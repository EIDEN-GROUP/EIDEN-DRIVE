"use client";
import { useEffect, useState } from "react";
import { Card, Pill } from "../ui/primitives";
import { badge, classify, formatBytes } from "@/lib/files";

export interface FileRow {
  id: string;
  name: string;
  mime?: string;
  size?: number;
  backends: string[];
  owner?: string;
  updated?: string;
}

const FOLDERS = ["Clients", "Projects", "Finance", "HR", "Design", "Video", "Contracts", "Archive"];

export default function DriveBrowser() {
  const [q, setQ] = useState("");
  const [type, setType] = useState("ALL");
  const [backend, setBackend] = useState("ALL");
  const [files, setFiles] = useState<FileRow[]>([]);
  const [selected, setSelected] = useState<FileRow | null>(null);

  useEffect(() => {
    let dead = false;
    fetch(`/api/drive?q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then((d) => { if (!dead) setFiles(d.results ?? []); })
      .catch(() => { if (!dead) setFiles([]); });
    return () => { dead = true; };
  }, [q]);

  const filtered = files.filter((f) => {
    if (type !== "ALL" && classify(f.name, f.mime) !== type) return false;
    if (backend !== "ALL" && !f.backends.includes(backend)) return false;
    return true;
  });

  async function trash(id: string) {
    await fetch("/api/drive/trash", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id: id }) });
    setFiles((p) => p.filter((f) => f.id !== id));
  }

  return (
    <section aria-label="Drive browser">
      <div className="flex flex-col md:flex-row gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files... (Google + USB + Backup)" aria-label="Search files"
          className="flex-1 min-h-[44px] px-4 rounded-2xl border border-[var(--e-line-strong)] bg-white" />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type" className="min-h-[44px] px-3 rounded-2xl border bg-white">
          {["ALL", "PDF", "DOCX", "XLSX", "PPTX", "IMAGE", "VIDEO", "DESIGN", "ARCHIVE", "HTML", "FILE"].map((t) => <option key={t}>{t}</option>)}
        </select>
        <select value={backend} onChange={(e) => setBackend(e.target.value)} aria-label="Filter by storage" className="min-h-[44px] px-3 rounded-2xl border bg-white">
          <option value="ALL">All storage</option><option value="google">☁ Google</option><option value="local">💾 Local</option><option value="backup">🛡 Backup</option>
        </select>
      </div>

      <div className="mt-4 grid md:grid-cols-[220px_1fr_300px] gap-4">
        <Card label="Folders">
          <ul className="mt-1 text-sm">
            {FOLDERS.map((f) => <li key={f}><button className="min-h-[44px] w-full text-left px-2 rounded-lg hover:bg-black/5">{f}</button></li>)}
          </ul>
        </Card>

        <Card label={`Files · ${filtered.length}`}>
          {filtered.length === 0 && <p className="text-sm mt-2 font-serif italic">Nothing here yet — drop files on the office USB or upload to Google, then search.</p>}
          <ul className="grid sm:grid-cols-2 gap-2 mt-1">
            {filtered.map((f) => (
              <li key={f.id} className="border rounded-2xl p-3 hover:shadow-md transition-shadow">
                <button onClick={() => setSelected(f)} className="w-full text-left min-h-[44px]" aria-label={`Open ${f.name}`}>
                  <div className="font-semibold text-sm truncate">{f.name}</div>
                  <div className="text-xs opacity-70">{classify(f.name, f.mime)} · {formatBytes(f.size)}</div>
                  <div className="text-xs mt-1">{badge(f.backends)}</div>
                </button>
                <div className="mt-2 flex gap-2">
                  <a href={`/drive/${f.id}`} className="text-xs underline min-h-[44px] px-2 grid place-items-center">Open</a>
                  <button onClick={() => trash(f.id)} className="text-xs underline text-red-700 min-h-[44px] px-2">Trash</button>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card label="Inspector">
          {!selected && <p className="text-sm font-serif italic">Select a file to see location, activity, versions.</p>}
          {selected && (
            <div className="text-sm">
              <div className="font-semibold">{selected.name}</div>
              <div className="mt-2 flex gap-1 flex-wrap"><Pill>☁ Google</Pill>{selected.backends.includes("local") && <Pill tone="fill">💾 Local</Pill>}</div>
              <p className="mt-2 text-xs">Owner: {selected.owner ?? "—"} · Updated: {selected.updated ?? "—"}</p>
              <a href={`/drive/${selected.id}`} className="mt-2 inline-block underline text-xs">Full preview + timeline →</a>
            </div>
          )}
        </Card>
      </div>
    </section>
  );
}
