"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Menu as MenuIcon, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, LayoutList, LayoutGrid, Rows3, CircleEllipsis,
  Clock, FileText, Trash2, House, Info, Download, Link2, Search, Upload, FolderPlus, RefreshCw, X, Undo2, ExternalLink
} from "lucide-react";
import { toast } from "../ui/Toast";
import ConfirmDialog from "../ui/ConfirmDialog";
import Modal from "../ui/Modal";
import Menu from "../ui/Menu";
import { FileGlyph, kindOf } from "../ui/Glyphs";
import { badge, classify, formatBytes } from "@/lib/files";

export interface Folder { id: string; name: string; parent: string | null; dept: string | null }
export interface FileRow {
  id: string; name: string; mime?: string; size?: number; backends: string[];
  owner?: string; updated?: string; updated_at?: string; folder?: string | null;
  hash?: string; storage_path?: string | null;
}
interface BinRow { file_id: string; deleted_at: string; purge_at: string; file_index: { id: string; name: string; mime: string; size: number } | { id: string; name: string; mime: string; size: number }[] }

type View = "list" | "grid";
type SortKey = "name" | "updated" | "size" | "kind";
type Nav = { kind: "root" | "recent" | "docs" | "bin"; path: string[] };

interface Row {
  key: string; kind: "folder" | "file"; id: string; name: string; depth: number;
  dept: string | null; file?: FileRow; folder?: Folder; expandable?: boolean;
}

const TAG_COLORS = ["#e5322d", "#2331e0", "#22c32e", "#f59e0b", "#ec4899", "#0ea5a4", "#8b5cf6"];
const DOC_KINDS = ["PDF", "DOCX", "XLSX", "PPTX", "HTML"];

async function sha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fmtDate(d?: string | null): string {
  if (!d) return "--";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "--";
  const date = t.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  let h = t.getHours();
  const m = String(t.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${date}, ${h}:${m} ${ap}`;
}

function kindLabel(name: string, cls: string): string {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (cls === "IMAGE") return `${ext.toUpperCase()} image`;
  if (cls === "VIDEO") return "Video";
  if (cls === "PDF") return "PDF";
  if (cls === "DOCX") return "Word document";
  if (cls === "XLSX") return "Spreadsheet";
  if (cls === "PPTX") return "Presentation";
  if (cls === "ARCHIVE") return "Archive";
  if (cls === "DESIGN") return "Design file";
  if (ext === "txt") return "Text file";
  return "File";
}

export default function Explorer() {
  const router = useRouter();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [bin, setBin] = useState<BinRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [hist, setHist] = useState<Nav[]>([{ kind: "root", path: [] }]);
  const [hi, setHi] = useState(0);
  const [view, setView] = useState<View>("list");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selKey, setSelKey] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [pane, setPane] = useState<boolean | null>(null); // null = decide after mount (responsive default)
  const [favOpen, setFavOpen] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(true);
  const [ctx, setCtx] = useState<{ x: number; y: number; row: Row } | null>(null);
  const [confirmTrash, setConfirmTrash] = useState<FileRow | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newName, setNewName] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const nav = hist[hi];
  const curFolder = nav.kind === "root" ? nav.path[nav.path.length - 1] ?? null : null;

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

  useEffect(() => { setPane(window.matchMedia("(min-width: 768px)").matches); }, []);
  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("click", close); window.addEventListener("scroll", close, true); window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); window.removeEventListener("keydown", esc); };
  }, [ctx]);

  // ── derived: folders / tags ──
  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const deptOf = useCallback((folderId?: string | null): string | null => {
    let id = folderId ?? null; let guard = 0;
    while (id && guard++ < 20) { const f = folderById.get(id); if (!f) return null; if (f.dept) return f.dept; id = f.parent; }
    return null;
  }, [folderById]);
  const depts = useMemo(() => Array.from(new Set(folders.map((f) => f.dept).filter(Boolean) as string[])).sort(), [folders]);
  const tagColor = useCallback((d: string | null) => d ? TAG_COLORS[Math.max(0, depts.indexOf(d)) % TAG_COLORS.length] : null, [depts]);
  const pathTo = useCallback((folderId: string): string[] => {
    const out: string[] = []; let id: string | null = folderId; let guard = 0;
    while (id && guard++ < 20) { out.unshift(id); id = folderById.get(id)?.parent ?? null; }
    return out;
  }, [folderById]);

  // ── rows ──
  const rows: Row[] = useMemo(() => {
    const dir = sort.dir;
    const fval = (f: FileRow): string | number => {
      if (sort.key === "size") return f.size ?? 0;
      if (sort.key === "updated") return f.updated_at ?? f.updated ?? "";
      if (sort.key === "kind") return classify(f.name, f.mime);
      return f.name.toLowerCase();
    };
    const sortFiles = (list: FileRow[]) => [...list].sort((a, b) => { const va = fval(a), vb = fval(b); return (va < vb ? -1 : va > vb ? 1 : 0) * dir; });
    const sortFolders = (list: Folder[]) => [...list].sort((a, b) => a.name.localeCompare(b.name) * (sort.key === "name" ? dir : 1));
    const fileRowOf = (f: FileRow, depth: number): Row => ({ key: f.id, kind: "file", id: f.id, name: f.name, depth, dept: deptOf(f.folder), file: f });
    const folderRowOf = (f: Folder, depth: number): Row => ({ key: `folder:${f.id}`, kind: "folder", id: f.id, name: f.name, depth, dept: deptOf(f.id), folder: f,
      expandable: folders.some((x) => x.parent === f.id) || files.some((x) => x.folder === f.id) });

    if (nav.kind === "bin") return [];
    if (nav.kind === "recent") return sortFiles(files).sort((a, b) => String(b.updated_at ?? b.updated ?? "").localeCompare(String(a.updated_at ?? a.updated ?? ""))).slice(0, 50).map((f) => fileRowOf(f, 0));
    if (nav.kind === "docs") return sortFiles(files.filter((f) => DOC_KINDS.includes(classify(f.name, f.mime)))).map((f) => fileRowOf(f, 0));
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      return [...sortFolders(folders.filter((f) => f.name.toLowerCase().includes(n))).map((f) => folderRowOf(f, 0)), ...sortFiles(files).map((f) => fileRowOf(f, 0))];
    }
    if (tagFilter) {
      return [...sortFolders(folders.filter((f) => deptOf(f.id) === tagFilter)).map((f) => folderRowOf(f, 0)),
        ...sortFiles(files.filter((f) => deptOf(f.folder) === tagFilter)).map((f) => fileRowOf(f, 0))];
    }
    const out: Row[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const f of sortFolders(folders.filter((x) => (x.parent ?? null) === parent))) {
        out.push(folderRowOf(f, depth));
        if (expanded.has(f.id)) walk(f.id, depth + 1);
      }
      for (const f of sortFiles(files.filter((x) => (x.folder ?? null) === parent))) out.push(fileRowOf(f, depth));
    };
    walk(curFolder, 0);
    return out;
  }, [nav.kind, files, folders, q, tagFilter, sort, expanded, curFolder, deptOf]);

  const sel: Row | null = useMemo(() => {
    if (!selKey) return null;
    if (nav.kind === "bin") {
      const b = bin.find((x) => (Array.isArray(x.file_index) ? x.file_index[0]?.id : x.file_index?.id) === selKey);
      if (!b) return null;
      const fi = Array.isArray(b.file_index) ? b.file_index[0] : b.file_index;
      const file: FileRow = { id: selKey, name: fi?.name ?? "?", mime: fi?.mime, size: fi?.size, backends: ["google"] };
      return { key: selKey, kind: "file", id: selKey, name: file.name, depth: 0, dept: null, file };
    }
    return rows.find((r) => r.key === selKey) ?? null;
  }, [selKey, rows, bin, nav.kind]);

  // ── navigation ──
  function go(n: Nav) {
    setHist((h) => [...h.slice(0, hi + 1), n]);
    setHi((i) => i + 1);
    setSelKey(null); setInfoOpen(false); setCtx(null); setTagFilter(null); setQ("");
  }
  function back() { if (hi > 0) { setHi(hi - 1); setSelKey(null); } }
  function forward() { if (hi < hist.length - 1) { setHi(hi + 1); setSelKey(null); } }

  function open(r: Row) {
    if (r.kind === "folder") { go({ kind: "root", path: pathTo(r.id) }); return; }
    if (!r.id.startsWith("g:")) router.push(`/drive/${r.id}`);
  }
  function toggleExpand(id: string) {
    setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function onRowKey(e: React.KeyboardEvent, r: Row) {
    if (e.key === "Enter") open(r);
    else if (e.key === " ") { e.preventDefault(); setSelKey(r.key); }
    else if (e.key === "ArrowRight" && r.kind === "folder" && !expanded.has(r.id)) toggleExpand(r.id);
    else if (e.key === "ArrowLeft" && r.kind === "folder" && expanded.has(r.id)) toggleExpand(r.id);
  }

  // ── actions (same endpoints as before) ──
  async function trash(f: FileRow) {
    const r = await fetch("/api/drive/trash", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id: f.id }) });
    if (r.ok) {
      toast({ text: `"${f.name}" moved to Recovery Bin (90 days).`, tone: "ok" });
      setFiles((p) => p.filter((x) => x.id !== f.id));
      setSelKey(null);
      load(q);
    } else toast({ text: "Trash failed. Try again.", tone: "err" });
    setConfirmTrash(null);
  }

  async function restore(id: string, name: string) {
    const r = await fetch("/api/drive/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id: id }) });
    if (r.ok) { toast({ text: `"${name}" restored.`, tone: "ok" }); setSelKey(null); load(q); }
    else toast({ text: "Restore needs a Manager account.", tone: "err" });
  }

  async function createFolder(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const r = await fetch("/api/folders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, parent: curFolder }) });
    if (r.ok) { toast({ text: `Folder "${name}" created.`, tone: "ok" }); setNewName(""); setShowNewFolder(false); load(q); }
    else toast({ text: "Couldn't create folder.", tone: "err" });
  }

  async function uploadPicked(list: FileList | null) {
    const file = list?.[0];
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
        body: JSON.stringify({ name: file.name, mime: file.type || "application/octet-stream", size: file.size, hash, backends: ["local"], storage_path: dj.path, folder: curFolder })
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

  function copyLink(r: Row) {
    const url = `${window.location.origin}/drive/${r.id}`;
    navigator.clipboard?.writeText(url).then(() => toast({ text: "Link copied.", tone: "ok" }), () => toast({ text: "Couldn't copy link.", tone: "err" }));
  }

  // ── view helpers ──
  const title = nav.kind === "recent" ? "Recent" : nav.kind === "docs" ? "Documents" : nav.kind === "bin" ? "Recovery Bin"
    : curFolder ? folderById.get(curFolder)?.name ?? "Folder" : "Root";
  const crumbs: { label: string; onClick?: () => void; folder?: boolean }[] = [{ label: "Root", onClick: () => go({ kind: "root", path: [] }) }];
  if (nav.kind === "root") nav.path.forEach((id, i) => crumbs.push({ label: folderById.get(id)?.name ?? "Folder", folder: true, onClick: i < nav.path.length - 1 ? () => go({ kind: "root", path: nav.path.slice(0, i + 1) }) : undefined }));
  else crumbs.push({ label: title, folder: nav.kind === "bin" });

  const folderCount = rows.filter((r) => r.kind === "folder").length;
  const fileRows = rows.filter((r) => r.kind === "file");
  const totalSize = fileRows.reduce((s, r) => s + (r.file?.size ?? 0), 0);
  const showInfo = !!sel && (view === "grid" || infoOpen || nav.kind === "bin");

  function sortBy(key: SortKey) { setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 })); }
  const arrow = (key: SortKey) => sort.key === key ? (sort.dir === 1 ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : null;
  const ariaSort = (key: SortKey) => sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none";

  const favItem = (on: boolean, onClick: () => void, icon: React.ReactNode, label: string, count?: number) => (
    <button onClick={onClick} aria-current={on ? "page" : undefined}
      className={`relative w-full min-h-[44px] pl-4 pr-3 rounded-md flex items-center gap-3 text-[15px] text-left transition-colors ${on ? "bg-tint text-brand font-medium" : "text-ink/85 hover:bg-tint/60"}`}>
      {on && <span className="absolute -left-1 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r bg-brand" />}
      <span className={on ? "text-brand" : "text-muted"}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {count ? <span className="text-[11px] text-muted">{count}</span> : null}
    </button>
  );

  return (
    <section aria-label="File explorer" className="relative h-full min-h-[520px] flex border border-line rounded-lg bg-surface overflow-hidden">
      {/* ── Favorites / Tags pane ── */}
      <aside aria-label="Favorites and tags"
        className={`${pane === null ? "hidden md:flex" : pane ? "flex" : "hidden"} absolute md:static inset-y-0 left-0 z-20 w-[232px] shrink-0 flex-col bg-soft border-r border-line px-3 py-3 overflow-y-auto shadow-pop md:shadow-none`}>
        <button onClick={() => setFavOpen((o) => !o)} aria-expanded={favOpen} className="flex items-center justify-between px-2 min-h-[36px] text-[13px] text-muted">
          Favorites {favOpen ? <ChevronDown size={16} className="text-brand" /> : <ChevronRight size={16} className="text-brand" />}
        </button>
        {favOpen && (
          <div className="flex flex-col gap-1 mb-2">
            {favItem(nav.kind === "recent", () => go({ kind: "recent", path: [] }), <Clock size={19} strokeWidth={1.6} />, "Recent")}
            {favItem(nav.kind === "docs", () => go({ kind: "docs", path: [] }), <FileText size={19} strokeWidth={1.6} />, "Documents")}
            {favItem(nav.kind === "bin", () => go({ kind: "bin", path: [] }), <Trash2 size={19} strokeWidth={1.6} />, "Recovery Bin", bin.length)}
            {favItem(nav.kind === "root" && !tagFilter, () => go({ kind: "root", path: [] }), <House size={19} strokeWidth={1.6} />, "Root")}
          </div>
        )}
        <button onClick={() => setTagsOpen((o) => !o)} aria-expanded={tagsOpen} className="mt-2 flex items-center justify-between px-2 min-h-[36px] text-[13px] text-muted">
          Tags {tagsOpen ? <ChevronDown size={16} className="text-brand" /> : <ChevronRight size={16} className="text-brand" />}
        </button>
        {tagsOpen && (
          <div className="flex flex-col gap-1">
            {depts.length === 0 && <p className="px-4 py-2 text-[12px] text-muted leading-snug">No tags yet. Managers set department tags on folders.</p>}
            {depts.map((d) => (
              <button key={d} onClick={() => { if (tagFilter === d) setTagFilter(null); else { setHist((h) => [...h.slice(0, hi + 1), { kind: "root", path: [] }]); setHi((i) => i + 1); setTagFilter(d); setSelKey(null); } }}
                aria-pressed={tagFilter === d}
                className={`w-full min-h-[44px] pl-4 pr-3 rounded-md flex items-center gap-3 text-[15px] text-left transition-colors ${tagFilter === d ? "bg-tint text-brand font-medium" : "text-ink/85 hover:bg-tint/60"}`}>
                <span className="size-2.5 rounded-full shrink-0" style={{ background: tagColor(d) ?? undefined }} />
                <span className="truncate">{d}</span>
              </button>
            ))}
          </div>
        )}
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Toolbar */}
        <div className="shrink-0 min-h-[56px] px-3 flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
          <button onClick={() => setPane((p) => !(p ?? true))} aria-label="Toggle favorites pane" className="size-9 grid place-items-center rounded-md hover:bg-tint"><MenuIcon size={21} strokeWidth={1.6} /></button>
          <span className="h-5 border-l border-line mx-1" />
          <button onClick={back} disabled={hi === 0} aria-label="Back" className="size-8 grid place-items-center rounded-md bg-tint text-brand disabled:opacity-40"><ChevronLeft size={18} /></button>
          <button onClick={forward} disabled={hi >= hist.length - 1} aria-label="Forward" className="size-8 grid place-items-center rounded-md bg-tint text-brand disabled:opacity-40"><ChevronRight size={18} /></button>
          <h2 className="ml-2 text-[16px] text-ink/90 truncate max-w-[40%]">{title}</h2>

          <div className="ml-auto flex items-center gap-1.5">
            <div className="relative">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search files"
                className="w-32 sm:w-52 min-h-[36px] pl-8 pr-2 rounded-md border border-line bg-surface text-[13px] placeholder:text-muted focus:border-brand focus:outline-none" />
            </div>
            <div role="group" aria-label="View" className="flex rounded-md overflow-hidden">
              <button onClick={() => setView("list")} aria-pressed={view === "list"} aria-label="List view" className={`size-9 grid place-items-center ${view === "list" ? "bg-tint text-brand" : "text-muted hover:bg-tint/60"}`}><LayoutList size={19} strokeWidth={1.6} /></button>
              <button onClick={() => setView("grid")} aria-pressed={view === "grid"} aria-label="Grid view" className={`size-9 grid place-items-center ${view === "grid" ? "bg-tint text-brand" : "text-muted hover:bg-tint/60"}`}><LayoutGrid size={19} strokeWidth={1.6} /></button>
            </div>
            <span className="h-5 border-l border-line mx-0.5" />
            <Menu label="Sort and filter" align="right" active={`${sort.key}:${sort.dir}`}
              trigger={<span className="flex items-center gap-0.5 text-ink/80"><Rows3 size={20} strokeWidth={1.6} /><ChevronDown size={12} /></span>}
              items={[
                { label: "Name A–Z", onSelect: () => setSort({ key: "name", dir: 1 }) },
                { label: "Name Z–A", onSelect: () => setSort({ key: "name", dir: -1 }) },
                { label: "Newest first", onSelect: () => setSort({ key: "updated", dir: -1 }) },
                { label: "Oldest first", onSelect: () => setSort({ key: "updated", dir: 1 }) },
                { label: "Largest first", onSelect: () => setSort({ key: "size", dir: -1 }) },
                { label: "Smallest first", onSelect: () => setSort({ key: "size", dir: 1 }) }
              ]} />
            <Menu label="More actions" align="right"
              trigger={<span className="flex items-center gap-0.5 text-ink/80"><CircleEllipsis size={21} strokeWidth={1.5} /><ChevronDown size={12} /></span>}
              items={[
                { label: uploading ? `Uploading ${uploading}…` : "Upload file", icon: <Upload size={14} />, onSelect: () => fileRef.current?.click() },
                { label: "New folder", icon: <FolderPlus size={14} />, onSelect: () => setShowNewFolder(true), hidden: nav.kind !== "root" },
                "sep",
                { label: "Refresh", icon: <RefreshCw size={14} />, onSelect: () => load(q) }
              ]} />
            <input ref={fileRef} type="file" className="hidden" aria-label="Choose file to upload" onChange={(e) => uploadPicked(e.target.files)} />
          </div>
        </div>

        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="shrink-0 h-8 px-3 flex items-center gap-1.5 text-[12px] text-ink/80 border-t border-line overflow-x-auto whitespace-nowrap">
          {crumbs.map((c, i) => (
            <span key={`${c.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight size={11} className="text-muted/70" />}
              {i === 0 ? <House size={13} className="text-brand" /> : c.folder ? <FileGlyph kind="folder" size={14} /> : null}
              {c.onClick ? <button onClick={c.onClick} className="hover:text-brand min-h-[24px]">{c.label}</button> : <span aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c.label}</span>}
            </span>
          ))}
        </nav>

        {/* Body */}
        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex-1 min-h-0 overflow-auto" onClick={() => { setSelKey(null); setInfoOpen(false); }}>
              {loading ? (
                <p className="p-6 text-sm text-muted" role="status">Reading drive…</p>
              ) : nav.kind === "bin" ? (
                bin.length === 0
                  ? <EmptyState title="Recovery Bin is empty" body="Deleted files rest here for 90 days. Members can never delete permanently." />
                  : (
                    <ul className="divide-y divide-line">
                      {bin.map((b) => {
                        const fi = Array.isArray(b.file_index) ? b.file_index[0] : b.file_index;
                        const id = fi?.id ?? b.file_id;
                        return (
                          <li key={b.file_id} onClick={(e) => { e.stopPropagation(); setSelKey(id); }}
                            className={`px-4 min-h-[44px] flex items-center gap-3 text-[14px] cursor-default ${selKey === id ? "bg-tint text-brand" : "hover:bg-tint/50"}`}>
                            <FileGlyph kind={kindOf(classify(fi?.name ?? ""))} size={22} />
                            <span className="flex-1 truncate">{fi?.name}</span>
                            <span className="text-[11px] text-muted hidden sm:block">purges {fmtDate(b.purge_at)}</span>
                            <button onClick={(e) => { e.stopPropagation(); restore(b.file_id, fi?.name ?? "?"); }} className="min-h-[36px] px-2 text-[12px] text-brand flex items-center gap-1 hover:underline"><Undo2 size={14} /> Restore</button>
                          </li>
                        );
                      })}
                    </ul>
                  )
              ) : rows.length === 0 ? (
                <EmptyState title={q ? "No matches" : "This folder is empty"} body={q ? "Clear the search or try a different name." : "Upload a file or create a folder to get started."}
                  action={!q && nav.kind === "root" ? { label: "Upload file", onClick: () => fileRef.current?.click() } : undefined} />
              ) : view === "list" ? (
                <div role="grid" aria-label={`${rows.length} items`} className="min-w-[420px]">
                  <div role="row" className="frow sticky top-0 z-10 h-10 px-4 bg-head text-[15px] text-ink/90 border-y border-line">
                    <button role="columnheader" aria-sort={ariaSort("name")} onClick={(e) => { e.stopPropagation(); sortBy("name"); }} className="text-left flex items-center gap-1 pl-[26px]">Name {arrow("name")}</button>
                    <span role="columnheader" className="frow-hide">Tags</span>
                    <span role="columnheader" className="frow-hide">Location</span>
                    <button role="columnheader" aria-sort={ariaSort("updated")} onClick={(e) => { e.stopPropagation(); sortBy("updated"); }} className="text-left flex items-center gap-1">Modified {arrow("updated")}</button>
                    <button role="columnheader" aria-sort={ariaSort("size")} onClick={(e) => { e.stopPropagation(); sortBy("size"); }} className="text-left flex items-center gap-1">Size {arrow("size")}</button>
                    <button role="columnheader" aria-sort={ariaSort("kind")} onClick={(e) => { e.stopPropagation(); sortBy("kind"); }} className="frow-hide text-left items-center gap-1">Kind {arrow("kind")}</button>
                  </div>
                  {rows.map((r) => {
                    const on = selKey === r.key;
                    const cls = r.file ? classify(r.file.name, r.file.mime) : "";
                    const color = tagColor(r.dept);
                    return (
                      <div key={r.key} role="row" tabIndex={0} aria-selected={on}
                        onClick={(e) => { e.stopPropagation(); setSelKey(r.key); }}
                        onDoubleClick={() => open(r)}
                        onKeyDown={(e) => onRowKey(e, r)}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSelKey(r.key); setCtx({ x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 260), row: r }); }}
                        className={`frow min-h-[36px] px-4 border-b border-line/70 cursor-default select-none transition-colors ${on ? "bg-tint text-brand" : "hover:bg-tint/40"}`}>
                        <div role="gridcell" className="flex items-center gap-2 min-w-0" style={{ paddingLeft: r.depth * 20 }}>
                          {r.kind === "folder" && r.expandable
                            ? <button onClick={(e) => { e.stopPropagation(); toggleExpand(r.id); }} aria-label={expanded.has(r.id) ? `Collapse ${r.name}` : `Expand ${r.name}`} aria-expanded={expanded.has(r.id)}
                                className="size-[18px] grid place-items-center text-muted hover:text-brand shrink-0">{expanded.has(r.id) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
                            : <span className="w-[18px] shrink-0" />}
                          <FileGlyph kind={kindOf(cls, r.kind === "folder")} size={24} className="shrink-0" />
                          <span className="text-[15px] truncate">{r.name}</span>
                        </div>
                        <div role="gridcell" className="frow-hide">
                          {color ? <span className="inline-block size-2.5 rounded-full" style={{ background: color }} title={r.dept ?? undefined} /> : <span className="text-[11px] text-muted">--</span>}
                        </div>
                        <div role="gridcell" className="frow-hide text-[11px] text-ink/75 truncate">{r.file ? badge(r.file.backends) || "--" : "--"}</div>
                        <div role="gridcell" className="text-[11px] text-ink/75 truncate">{r.file ? fmtDate(r.file.updated_at ?? r.file.updated) : "--"}</div>
                        <div role="gridcell" className="text-[11px] text-ink/75 tabular-nums">{r.file?.size ? formatBytes(r.file.size) : "--"}</div>
                        <div role="gridcell" className="frow-hide text-[11px] text-ink/75 truncate">{r.file ? kindLabel(r.file.name, cls) : "Folder"}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div role="grid" aria-label={`${rows.length} items`} className="p-4 grid gap-1 content-start" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))" }}>
                  {rows.map((r) => {
                    const on = selKey === r.key;
                    const cls = r.file ? classify(r.file.name, r.file.mime) : "";
                    return (
                      <button key={r.key} role="gridcell" aria-selected={on}
                        onClick={(e) => { e.stopPropagation(); setSelKey(r.key); }}
                        onDoubleClick={() => open(r)}
                        onKeyDown={(e) => onRowKey(e, r)}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSelKey(r.key); setCtx({ x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 260), row: r }); }}
                        className={`flex flex-col items-center gap-2 p-3 rounded-lg text-center transition-colors min-h-[104px] ${on ? "bg-tint text-brand" : "hover:bg-tint/40"}`}>
                        <FileGlyph kind={kindOf(cls, r.kind === "folder")} size={52} />
                        <span className="text-[12.5px] leading-tight break-all line-clamp-2">{r.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <p className="shrink-0 h-8 px-4 flex items-center text-[11px] text-muted border-t border-line" role="status">
              {nav.kind === "bin" ? `${bin.length} in bin` : `${folderCount} folders · ${fileRows.length} files · ${formatBytes(totalSize)}`}
            </p>
          </div>

          {/* Details */}
          {showInfo && sel && (
            <aside aria-label="Details"
              className="fixed lg:static inset-x-0 bottom-0 z-30 lg:z-auto max-h-[75vh] lg:max-h-none w-full lg:w-[296px] shrink-0 overflow-y-auto bg-surface border-t lg:border-t-0 lg:border-l border-line rounded-t-2xl lg:rounded-none shadow-pop lg:shadow-none p-4 flex flex-col pop-in">
              <button onClick={() => { setSelKey(null); setInfoOpen(false); }} aria-label="Close details" className="self-end -mt-1 -mr-1 mb-1 size-8 grid place-items-center rounded-md hover:bg-tint text-muted"><X size={16} /></button>
              <div className="h-[200px] rounded-lg border border-line bg-soft grid place-items-center overflow-hidden">
                {sel.file && classify(sel.file.name, sel.file.mime) === "IMAGE" && !sel.id.startsWith("g:")
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={`/api/drive/download?file_id=${sel.id}`} alt={`Preview of ${sel.name}`} className="max-h-full max-w-full object-contain" />
                  : <FileGlyph kind={kindOf(sel.file ? classify(sel.file.name, sel.file.mime) : "", sel.kind === "folder")} size={84} />}
              </div>
              <div className="mt-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium break-all">{sel.name}</p>
                  <p className="text-[11px] text-muted">{sel.file ? kindLabel(sel.file.name, classify(sel.file.name, sel.file.mime)) : "Folder"}</p>
                </div>
                {sel.file?.size ? <span className="text-[11px] text-ink/75 shrink-0">{formatBytes(sel.file.size)}</span> : null}
              </div>
              <dl className="mt-3 text-[12px]">
                {[
                  ["Modified", sel.file ? fmtDate(sel.file.updated_at ?? sel.file.updated) : "--"],
                  ["Location", sel.file ? badge(sel.file.backends) || "--" : "--"],
                  ["Owner", sel.file?.owner ? `${sel.file.owner.slice(0, 8)}…` : "--"],
                  ["SHA-256", sel.file?.hash ? `${sel.file.hash.slice(0, 12)}…` : "--"]
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3 py-2.5 border-b border-line">
                    <dt className="text-ink/80">{k} :</dt><dd className="text-[11px] text-ink/75 text-right truncate">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-3">
                <p className="text-[12px] text-ink/80">Tags</p>
                <div className="mt-1.5 flex gap-1.5 flex-wrap">
                  {sel.dept ? <span className="px-2 py-0.5 rounded text-[10px] text-white" style={{ background: tagColor(sel.dept) ?? "var(--brand)" }}>{sel.dept}</span> : <span className="text-[11px] text-muted">No tags</span>}
                </div>
              </div>
              <div className="mt-auto pt-6 flex items-center justify-center divide-x divide-line text-ink/80">
                {sel.kind === "file" && !sel.id.startsWith("g:") && nav.kind !== "bin" && (
                  <button onClick={() => router.push(`/drive/${sel.id}`)} aria-label="Open" className="px-4 min-h-[40px] hover:text-brand"><ExternalLink size={19} strokeWidth={1.6} /></button>
                )}
                {sel.kind === "file" && !sel.id.startsWith("g:") && (
                  <a href={`/api/drive/download?file_id=${sel.id}`} aria-label="Download" className="px-4 min-h-[40px] grid place-items-center hover:text-brand"><Download size={19} strokeWidth={1.6} /></a>
                )}
                {sel.kind === "file" && nav.kind === "bin" && (
                  <button onClick={() => restore(sel.id, sel.name)} aria-label="Restore" className="px-4 min-h-[40px] hover:text-brand"><Undo2 size={19} strokeWidth={1.6} /></button>
                )}
                {sel.kind === "file" && !sel.id.startsWith("g:") && nav.kind !== "bin" && sel.file && (
                  <button onClick={() => setConfirmTrash(sel.file!)} aria-label="Move to Recovery Bin" className="px-4 min-h-[40px] hover:text-danger"><Trash2 size={19} strokeWidth={1.6} /></button>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* Context menu (right-click) */}
      {ctx && (
        <div role="menu" style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}
          className="pop-in fixed z-[70] w-[184px] py-1.5 rounded-lg bg-surface border border-line shadow-pop text-[13px]">
          {[
            { label: "Open", on: () => open(ctx.row), show: !(ctx.row.kind === "file" && ctx.row.id.startsWith("g:")) },
            { label: "Get Info", icon: <Info size={14} />, on: () => { setSelKey(ctx.row.key); setInfoOpen(true); }, show: true },
            { label: "Download", icon: <Download size={14} />, on: () => { window.location.href = `/api/drive/download?file_id=${ctx.row.id}`; }, show: ctx.row.kind === "file" && !ctx.row.id.startsWith("g:") },
            { label: "Copy link", icon: <Link2 size={14} />, on: () => copyLink(ctx.row), show: !ctx.row.id.startsWith("g:") && ctx.row.kind === "file" },
            { label: "Delete", icon: <Trash2 size={14} />, danger: true, on: () => ctx.row.file && setConfirmTrash(ctx.row.file), show: ctx.row.kind === "file" && !ctx.row.id.startsWith("g:") }
          ].filter((i) => i.show).map((i) => (
            <button key={i.label} role="menuitem" onClick={() => { const fn = i.on; setCtx(null); fn(); }}
              className={`w-full flex items-center justify-between px-3.5 py-2 text-left hover:bg-tint ${"danger" in i && i.danger ? "text-danger" : "text-ink"}`}>
              <span>{i.label}</span>{"icon" in i && i.icon ? <span className="text-muted">{i.icon}</span> : null}
            </button>
          ))}
          {depts.length > 0 && (
            <>
              <div className="my-1 border-t border-line" />
              <p className="px-3.5 pt-1 text-[11px] text-muted">Tags</p>
              <div className="px-3.5 py-2 flex gap-2">
                {depts.slice(0, 7).map((d) => (
                  <button key={d} aria-label={`Show tag ${d}`} title={d} onClick={() => { setCtx(null); setTagFilter(d); }}
                    className="size-3 rounded-full ring-offset-2 ring-offset-surface hover:ring-2 ring-brand" style={{ background: tagColor(d) ?? undefined }} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <Modal open={showNewFolder} title="New folder" onClose={() => setShowNewFolder(false)} labelId="nf-title" width={400}>
        <form onSubmit={createFolder} className="flex flex-col gap-4">
          <div>
            <label htmlFor="nf-name" className="block text-[13px] text-muted">Folder name</label>
            <input id="nf-name" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120}
              className="w-full min-h-[44px] mt-1 bg-transparent border-0 border-b border-[#8f8f9a] focus:border-b-2 focus:border-brand focus:outline-none rounded-none px-0 text-[16px]" />
            <p className="text-[12px] text-muted mt-2">Created inside “{title}”.</p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowNewFolder(false)} className="min-h-[40px] px-4 rounded-md border border-line text-sm hover:bg-tint">Cancel</button>
            <button disabled={!newName.trim()} className="min-h-[40px] px-4 rounded-md bg-brand text-white text-sm font-medium disabled:opacity-50">Create</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={!!confirmTrash} title="Move to Recovery Bin?"
        body={`"${confirmTrash?.name}" stays recoverable for 90 days. Members can never delete permanently.`}
        confirmLabel="Move to Bin" onClose={() => setConfirmTrash(null)} onConfirm={() => confirmTrash && trash(confirmTrash)} />
    </section>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="h-full min-h-[260px] grid place-items-center p-8 text-center">
      <div className="flex flex-col items-center">
        <FileGlyph kind="folder" size={56} className="opacity-30" />
        <p className="mt-3 text-[15px] font-medium">{title}</p>
        <p className="mt-1 text-[13px] text-muted max-w-xs">{body}</p>
        {action && <button onClick={action.onClick} className="mt-4 min-h-[40px] px-4 rounded-md bg-brand text-white text-sm font-medium flex items-center gap-2"><Upload size={15} /> {action.label}</button>}
      </div>
    </div>
  );
}
