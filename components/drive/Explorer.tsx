"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Pill } from "../ui/primitives";
import { toast } from "../ui/Toast";
import ConfirmDialog from "../ui/ConfirmDialog";
import { badge, classify, formatBytes } from "@/lib/files";
import {
  FolderIcon, TypeIcon, UploadIcon, PlusIcon, GridIcon, ListIcon, SearchIcon,
  TrashIcon, RestoreIcon, ChevronRight, XIcon, DownloadIcon, EyeIcon, BackIcon
} from "../ui/icons";

export interface Folder { id: string; name: string; parent: string | null; dept: string | null }
export interface FileRow {
  id: string; name: string; mime?: string; size?: number; backends: string[];
  owner?: string; updated?: string; updated_at?: string; folder?: string | null;
  hash?: string; storage_path?: string | null;
}
interface BinRow { file_id: string; deleted_at: string; purge_at: string; file_index: { id: string; name: string; mime: string; size: number } | { id: string; name: string; mime: string; size: number }[] }

type View = "grid" | "list";
type SortKey = "name" | "size" | "updated" | "type";

const SEED = ["Clients", "Projects", "Finance", "HR", "Design", "Video", "Contracts", "Archive"];

async function sha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function Explorer() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [bin, setBin] = useState<BinRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [loc, setLoc] = useState<string>("all"); // all | bin | folder:<id>
  const [view, setView] = useState<View>("grid");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [typeF, setTypeF] = useState("ALL");
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmTrash, setConfirmTrash] = useState<FileRow | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newName, setNewName] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const [fr, dr, br] = await Promise.all([
        fetch("/api/folders").then((r) => r.json()),
        fetch(`/api/drive?q=${encodeURIComponent(query)}`).then((r) => r.json()),
        fetch("/api/drive/bin").then((r) => r.json())
      ]);
      setFolders(fr.results ?? []);
      setFiles(dr.results ?? []);
      setBin(br.results ?? []);
    } catch {
      toast({ text: "Couldn't reach the server. Showing cached view.", tone: "err" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(q), q ? 350 : 0);
    return () => clearTimeout(t);
  }, [q, load]);

  const inScope = useMemo(() => {
    if (loc === "bin") return [];
    let list = files;
    if (loc.startsWith("folder:")) {
      const id = loc.slice(7);
      list = list.filter((f) => f.folder === id);
    }
    if (typeF !== "ALL") list = list.filter((f) => classify(f.name, f.mime) === typeF);
    const dir = sort.dir;
    return [...list].sort((a, b) => {
      const val = (f: FileRow): string | number => {
        if (sort.key === "size") return f.size ?? 0;
        if (sort.key === "updated") return f.updated_at ?? f.updated ?? "";
        if (sort.key === "type") return classify(f.name, f.mime);
        return f.name.toLowerCase();
      };
      const va = val(a), vb = val(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
  }, [files, loc, typeF, sort]);

  const sel: FileRow | null = useMemo(() => {
    if (!selected) return null;
    if (loc === "bin") {
      const b = bin.find((x) => (Array.isArray(x.file_index) ? x.file_index[0]?.id : x.file_index?.id) === selected);
      if (!b) return null;
      const fi = Array.isArray(b.file_index) ? b.file_index[0] : b.file_index;
      return { id: selected, name: fi?.name ?? "?", mime: fi?.mime, size: fi?.size, backends: ["google"] };
    }
    return files.find((f) => f.id === selected) ?? null;
  }, [selected, files, bin, loc]);

  const crumbs = useMemo(() => {
    if (loc === "all") return ["All files"];
    if (loc === "bin") return ["Recovery Bin"];
    const f = folders.find((x) => x.id === loc.slice(7));
    return ["All files", f?.name ?? "Folder"];
  }, [loc, folders]);

  async function trash(f: FileRow) {
    const r = await fetch("/api/drive/trash", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id: f.id }) });
    if (r.ok) {
      toast({ text: `"${f.name}" moved to Recovery Bin (90 days).`, tone: "ok" });
      setFiles((p) => p.filter((x) => x.id !== f.id));
      setSelected(null);
      load(q);
    } else toast({ text: "Trash failed. Try again.", tone: "err" });
    setConfirmTrash(null);
  }

  async function restore(id: string, name: string) {
    const r = await fetch("/api/drive/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id: id }) });
    if (r.ok) { toast({ text: `"${name}" restored.`, tone: "ok" }); setSelected(null); load(q); }
    else toast({ text: "Restore needs a Manager account.", tone: "err" });
  }

  async function createFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const r = await fetch("/api/folders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: newName.trim() }) });
    if (r.ok) { toast({ text: `Folder "${newName.trim()}" created.`, tone: "ok" }); setNewName(""); setShowNewFolder(false); load(q); }
    else toast({ text: "Couldn't create folder.", tone: "err" });
  }

  async function uploadPicked(files: FileList | null) {
    const file = picked?.[0];
    if (!file) return;
    setUploading(file.name);
    try {
      const hash = await sha256(file);
      const init = await fetch("/api/drive/upload-url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: file.name, mime: file.type || "application/octet-stream", size: file.size }) });
      const dj = await init.json();
      if (!init.ok) throw new Error(dj.error ?? "upload init failed");
      const put = await fetch(dj.signedUrl, { method: "PUT", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
      if (!put.ok) throw new Error("byte upload failed");
      const meta = await fetch("/api/drive/upload", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: file.name, mime: file.type || "application/octet-stream", size: file.size, hash,
          backends: ["local"], storage_path: dj.path,
          folder: loc.startsWith("folder:") ? loc.slice(7) : null
        })
      });
      if (!meta.ok) throw new Error("indexing failed");
      toast({ text: `"${file.name}" uploaded and indexed.`, tone: "ok" });
      load(q);
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "Upload failed.", tone: "err" });
    } finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const totalSize = inScope.reduce((s, f) => s + (f.size ?? 0), 0);
  const folderCount = loc === "all" ? folders.length || SEED.length : 0;

  return (
    <section aria-label="File explorer" className="flex flex-col gap-3">
      {/* ── Toolbar ── */}
      <div className="card bg-white p-3 flex flex-col gap-2">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm min-h-[32px] flex-wrap">
          {loc !== "all" && (
            <button onClick={() => setLoc("all")} className="min-w-[44px] min-h-[44px] grid place-items-center rounded-lg hover:bg-black/5" aria-label="Back to all files"><BackIcon /></button>
          )}
          {crumbs.map((c, i) => (
            <span key={c} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={14} />}
              {i === 0 && loc !== "all"
                ? <button onClick={() => setLoc("all")} className="underline min-h-[32px]">{c}</button>
                : <span aria-current={i === crumbs.length - 1 ? "page" : undefined} className={i === crumbs.length - 1 ? "font-semibold" : ""}>{c}</span>}
            </span>
          ))}
        </nav>
        <div className="flex flex-col md:flex-row gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50"><SearchIcon /></span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this drive…" aria-label="Search files"
              className="w-full min-h-[44px] pl-10 pr-4 rounded-2xl border border-[var(--e-line-strong)] bg-white" />
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setShowNewFolder((s) => !s)} className="min-h-[44px] px-4 rounded-2xl border font-semibold flex items-center gap-2" aria-expanded={showNewFolder}>
              <PlusIcon size={18} /> New folder
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={!!uploading} className="min-h-[44px] px-4 rounded-2xl bg-teal-600 text-cream-50 font-semibold flex items-center gap-2 disabled:opacity-50">
              <UploadIcon size={18} /> {uploading ? `Uploading ${uploading}…` : "Upload"}
            </button>
            <input ref={fileRef} type="file" className="hidden" aria-label="Choose file to upload" onChange={(e) => uploadPicked(e.target.files)} />
            <div role="group" aria-label="View" className="flex rounded-2xl border overflow-hidden">
              <button onClick={() => setView("grid")} aria-pressed={view === "grid"} aria-label="Grid view" className={`min-w-[44px] min-h-[44px] grid place-items-center ${view === "grid" ? "bg-[var(--e-green-900)] text-cream-50" : ""}`}><GridIcon /></button>
              <button onClick={() => setView("list")} aria-pressed={view === "list"} aria-label="List view" className={`min-w-[44px] min-h-[44px] grid place-items-center ${view === "list" ? "bg-[var(--e-green-900)] text-cream-50" : ""}`}><ListIcon /></button>
            </div>
          </div>
        </div>
        {showNewFolder && (
          <form onSubmit={createFolder} className="flex gap-2">
            <label htmlFor="nf-name" className="sr-only">Folder name</label>
            <input id="nf-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Folder name…" maxLength={120}
              className="flex-1 min-h-[44px] px-4 rounded-2xl border" />
            <button className="min-h-[44px] px-4 rounded-2xl bg-[var(--e-green-900)] text-cream-50">Create</button>
          </form>
        )}
        <div className="flex gap-2 flex-wrap items-center">
          <label className="text-xs" htmlFor="type-f">Type</label>
          <select id="type-f" value={typeF} onChange={(e) => setTypeF(e.target.value)} className="min-h-[44px] px-3 rounded-xl border bg-white text-sm">
            {["ALL", "PDF", "DOCX", "XLSX", "PPTX", "IMAGE", "VIDEO", "DESIGN", "ARCHIVE", "HTML", "FILE"].map((t) => <option key={t}>{t}</option>)}
          </select>
          <label className="text-xs" htmlFor="sort-f">Sort</label>
          <select id="sort-f" value={`${sort.key}:${sort.dir}`} onChange={(e) => { const [key, dir] = e.target.value.split(":"); setSort({ key: key as SortKey, dir: Number(dir) as 1 | -1 }); }}
            className="min-h-[44px] px-3 rounded-xl border bg-white text-sm">
            <option value="name:1">Name A–Z</option><option value="name:-1">Name Z–A</option>
            <option value="updated:-1">Newest</option><option value="updated:1">Oldest</option>
            <option value="size:-1">Largest</option><option value="size:1">Smallest</option>
            <option value="type:1">Type</option>
          </select>
        </div>
      </div>

      <div className="grid md:grid-cols-[230px_1fr] xl:grid-cols-[230px_1fr_300px] gap-3 items-start">
        {/* ── Folder tree ── */}
        <Card label="Folders">
          <ul className="mt-1 text-sm" role="tree" aria-label="Folder tree">
            <li role="treeitem" aria-selected={loc === "all"}>
              <button onClick={() => { setLoc("all"); setSelected(null); }} className={`w-full text-left min-h-[44px] px-2 rounded-lg hover:bg-black/5 flex items-center gap-2 ${loc === "all" ? "font-bold bg-black/5" : ""}`}>
                <FolderIcon size={18} /> All files
              </button>
            </li>
            {(folders.length ? folders : SEED.map((name) => ({ id: `seed:${name}`, name, parent: null, dept: null }))).map((f) => (
              <li key={f.id} role="treeitem" aria-selected={loc === `folder:${f.id}`}>
                <button onClick={() => { setLoc(`folder:${f.id}`); setSelected(null); }}
                  className={`w-full text-left min-h-[44px] px-2 rounded-lg hover:bg-black/5 flex items-center gap-2 ${loc === `folder:${f.id}` ? "font-bold bg-black/5" : ""}`}>
                  <FolderIcon size={18} /> <span className="truncate">{f.name}</span>
                </button>
              </li>
            ))}
            <li role="treeitem" aria-selected={loc === "bin"}>
              <button onClick={() => { setLoc("bin"); setSelected(null); }} className={`w-full text-left min-h-[44px] px-2 rounded-lg hover:bg-black/5 flex items-center gap-2 ${loc === "bin" ? "font-bold bg-black/5" : ""}`}>
                <TrashIcon size={18} /> Recovery Bin {bin.length > 0 && <Pill>{bin.length}</Pill>}
              </button>
            </li>
          </ul>
        </Card>

        {/* ── Main pane ── */}
        <div className="flex flex-col gap-3 min-w-0">
          {loading ? (
            <Card label="Loading"><p className="text-sm font-serif italic" role="status">Reading drive…</p></Card>
          ) : loc === "bin" ? (
            <Card label={`Recovery Bin · ${bin.length} (auto-purge 90 days)`}>
              {bin.length === 0
                ? <p className="text-sm font-serif italic">Bin is empty. Deleted files rest here for 90 days — members can never delete permanently.</p>
                : <ul className="divide-y">
                  {bin.map((b) => {
                    const fi = Array.isArray(b.file_index) ? b.file_index[0] : b.file_index;
                    return (
                      <li key={b.file_id} className="py-2 flex items-center gap-2 text-sm">
                        <TypeIcon kind={classify(fi?.name ?? "")} />
                        <button className="flex-1 text-left min-h-[44px] truncate underline" onClick={() => setSelected(b.file_id)}>{fi?.name}</button>
                        <span className="text-xs opacity-60">purge {new Date(b.purge_at).toLocaleDateString()}</span>
                        <button onClick={() => restore(b.file_id, fi?.name ?? "?")} className="min-h-[44px] px-2 text-xs underline flex items-center gap-1"><RestoreIcon size={14} /> Restore</button>
                      </li>
                    );
                  })}
                </ul>}
            </Card>
          ) : view === "grid" ? (
            <Card label={`${inScope.length} items`}>
              {inScope.length === 0
                ? <p className="text-sm font-serif italic">This folder is empty. Upload a file or create a subfolder to get started.</p>
                : <ul className="grid grid-cols-2 lg:grid-cols-3 gap-2 mt-1">
                  {inScope.map((f) => (
                    <li key={f.id}>
                      <button onClick={() => setSelected(f.id)} onDoubleClick={() => { window.location.href = `/drive/${f.id}`; }}
                        aria-selected={selected === f.id}
                        className={`w-full text-left min-h-[88px] p-3 rounded-2xl border transition-colors ${selected === f.id ? "border-teal-600 bg-teal-600/5" : "hover:bg-black/[.03]"}`}>
                        <TypeIcon kind={classify(f.name, f.mime)} size={24} />
                        <div className="font-semibold text-sm truncate mt-1">{f.name}</div>
                        <div className="text-xs opacity-70">{formatBytes(f.size)} · {badge(f.backends)}</div>
                      </button>
                    </li>
                  ))}
                </ul>}
            </Card>
          ) : (
            <Card label={`${inScope.length} items`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs opacity-70">
                    <th className="py-2 pr-2 font-semibold" aria-sort={sort.key === "name" ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>Name</th>
                    <th className="pr-2">Type</th><th className="pr-2">Size</th><th className="pr-2">Location</th><th><span className="sr-only">Actions</span></th>
                  </tr></thead>
                  <tbody>
                    {inScope.map((f) => (
                      <tr key={f.id} className={`border-t ${selected === f.id ? "bg-teal-600/5" : ""}`}>
                        <td className="py-1 pr-2">
                          <button onClick={() => setSelected(f.id)} className="flex items-center gap-2 min-h-[44px] text-left underline decoration-transparent hover:underline">
                            <TypeIcon kind={classify(f.name, f.mime)} /> <span className="truncate max-w-[220px]">{f.name}</span>
                          </button>
                        </td>
                        <td className="pr-2 text-xs">{classify(f.name, f.mime)}</td>
                        <td className="pr-2 text-xs tabular-nums">{formatBytes(f.size)}</td>
                        <td className="pr-2 text-xs">{badge(f.backends)}</td>
                        <td><a href={`/drive/${f.id}`} className="text-xs underline min-h-[44px] inline-flex items-center" aria-label={`Open ${f.name}`}><EyeIcon size={16} /></a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {inScope.length === 0 && <p className="text-sm font-serif italic py-3">No files match. Clear search or filters.</p>}
              </div>
            </Card>
          )}

          {/* ── Status bar ── */}
          <p className="text-xs opacity-70 px-1" role="status">
            {loc === "bin" ? `${bin.length} in bin` : `${folderCount} folders · ${inScope.length} files · ${formatBytes(totalSize)}`}
          </p>
        </div>

        {/* ── Details pane ── */}
        <div className="xl:block">
          <Card label="Details">
            {!sel && <p className="text-sm font-serif italic">Select a file to preview details, open, download, or move to Bin.</p>}
            {sel && (
              <div className="text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold break-all">{sel.name}</p>
                  <button onClick={() => setSelected(null)} aria-label="Close details" className="min-w-[44px] min-h-[44px] grid place-items-center rounded-lg hover:bg-black/5"><XIcon size={16} /></button>
                </div>
                <div className="mt-2 flex gap-1 flex-wrap">
                  {sel.backends.map((b) => <Pill key={b} tone={b === "google" ? "default" : b === "local" ? "fill" : "green"}>{b === "google" ? "☁ Google" : b === "local" ? "💾 Local" : "🛡 Backup"}</Pill>)}
                </div>
                <dl className="mt-2 text-xs grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                  <dt className="opacity-60">Type</dt><dd>{classify(sel.name, sel.mime)}</dd>
                  <dt className="opacity-60">Size</dt><dd className="tabular-nums">{formatBytes(sel.size)}</dd>
                  <dt className="opacity-60">Modified</dt><dd>{sel.updated_at ?? sel.updated ?? "—"}</dd>
                  <dt className="opacity-60">SHA-256</dt><dd className="truncate">{sel.hash ? `${sel.hash.slice(0, 12)}…` : "—"}</dd>
                </dl>
                <div className="mt-3 flex gap-2 flex-wrap">
                  {!sel.id.startsWith("g:") && <a href={`/drive/${sel.id}`} className="min-h-[44px] px-3 inline-flex items-center gap-1 rounded-2xl bg-teal-600 text-cream-50 text-xs font-semibold"><EyeIcon size={14} /> Open</a>}
                  {!sel.id.startsWith("g:") && <a href={`/api/drive/download?file_id=${sel.id}`} className="min-h-[44px] px-3 inline-flex items-center gap-1 rounded-2xl border text-xs font-semibold"><DownloadIcon size={14} /> Download</a>}
                  {loc === "bin"
                    ? <button onClick={() => restore(sel.id, sel.name)} className="min-h-[44px] px-3 inline-flex items-center gap-1 rounded-2xl border text-xs font-semibold"><RestoreIcon size={14} /> Restore</button>
                    : !sel.id.startsWith("g:") && <button onClick={() => setConfirmTrash(sel)} className="min-h-[44px] px-3 inline-flex items-center gap-1 rounded-2xl border border-red-300 text-red-700 text-xs font-semibold"><TrashIcon size={14} /> Trash</button>}
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      <ConfirmDialog open={!!confirmTrash} title="Move to Recovery Bin?"
        body={`"${confirmTrash?.name}" stays recoverable for 90 days. Members can never delete permanently.`}
        confirmLabel="Move to Bin" onClose={() => setConfirmTrash(null)} onConfirm={() => confirmTrash && trash(confirmTrash)} />
    </section>
  );
}

async function restore(id: string, name: string) {
  const r = await fetch("/api/drive/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id: id }) });
  const { toast: t } = await import("../ui/Toast");
  if (r.ok) { t({ text: `"${name}" restored.`, tone: "ok" }); window.location.reload(); }
  else t({ text: "Restore needs a Manager account.", tone: "err" });
}
