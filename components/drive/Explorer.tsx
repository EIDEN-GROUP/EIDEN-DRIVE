"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Menu as MenuIcon, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, LayoutList, LayoutGrid, Rows3, CircleEllipsis,
  Clock, FileText, Trash2, House, Info, Download, Link2, Search, Upload, FolderPlus, RefreshCw, X, Undo2, ExternalLink, Pencil, CloudDownload,
  Eye, Copy, ClipboardPaste, HardDrive, Plus, Check, MoreHorizontal, Tag as TagIcon
} from "lucide-react";
import { toast } from "../ui/Toast";
import ConfirmDialog from "../ui/ConfirmDialog";
import Modal from "../ui/Modal";
import Menu from "../ui/Menu";
import FileViewer, { type ViewFile } from "./FileViewer";
import FileEditor from "./FileEditor";
import { editable, viewKind } from "./filetext";
import { FileGlyph, FileIcon, FolderIcon, kindOf } from "../ui/Glyphs";
import Pagination, { usePagination } from "../ui/Pagination";
import { useTags } from "../tags/useTags";
import { TagChip, TagDot, TagDots, TagEditor, TagPicker } from "../tags/TagUI";
import type { Tag, TagKind } from "../tags/useTags";
import { badge, classify, formatBytes } from "@/lib/files";

export interface Folder { id: string; name: string; parent: string | null; dept: string | null }
export interface FileRow {
  id: string; name: string; mime?: string; size?: number; backends: string[];
  owner?: string; updated?: string; updated_at?: string; folder?: string | null;
  hash?: string; storage_path?: string | null; accountLabel?: string; google_file_id?: string | null;
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
  const k = viewKind(name);
  const E = ext.toUpperCase();
  switch (k) {
    case "image": return `${E} image`;
    case "video": return "Video";
    case "audio": return "Audio";
    case "pdf": return "PDF document";
    case "docx": case "odf": case "rtf": return "Document";
    case "legacy": return "Legacy Office file";
    case "sheet": return "Spreadsheet";
    case "csv": return "CSV table";
    case "slides": return "Presentation";
    case "archive": return "Archive";
    case "ebook": return "Ebook";
    case "font": return "Font";
    case "json": return "JSON data";
    case "notebook": return "Notebook";
    case "markdown": return "Markdown";
    case "html": return "Web page";
    case "code": return ["txt", "log"].includes(ext) ? "Text file" : "Source / text";
    default: return cls === "DESIGN" ? "Design file" : ext ? `${E} file` : "File";
  }
}

export default function Explorer() {
  const router = useRouter();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [bin, setBin] = useState<BinRow[]>([]);
  const [canPurge, setCanPurge] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState<{ id: string; name: string } | null>(null);
  const [purging, setPurging] = useState(false);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [hist, setHist] = useState<Nav[]>([{ kind: "root", path: [] }]);
  const [hi, setHi] = useState(0);
  const [view, setView] = useState<View>("list");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [tagFilter, setTagFilter] = useState<string | null>(null); // department filter (manager-set folder.dept)
  const tg = useTags();                                            // user-created tags
  const [tagSel, setTagSel] = useState<string[]>([]);              // active tag filters (AND)
  const [tagEditor, setTagEditor] = useState<{ tag?: Tag } | null>(null);
  const [tagPicker, setTagPicker] = useState<{ kind: TagKind; id: string; name: string } | null>(null);
  const [confirmTagDel, setConfirmTagDel] = useState<Tag | null>(null);
  const [drivesOpen, setDrivesOpen] = useState(true);
  const [deptOpen, setDeptOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selKey, setSelKey] = useState<string | null>(null);
  // Multi-select: selKey is the anchor/primary (details pane), multi holds the rest.
  const [multi, setMulti] = useState<string[]>([]);
  const anchorRef = useRef<number>(-1);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const selSet = useMemo(() => new Set([selKey, ...multi].filter(Boolean) as string[]), [selKey, multi]);
  function clearSel() { setSelKey(null); setMulti([]); anchorRef.current = -1; }
  const [infoOpen, setInfoOpen] = useState(false);
  const [pane, setPane] = useState<boolean | null>(null); // null = decide after mount (responsive default)
  const [favOpen, setFavOpen] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(true);
  const [ctx, setCtx] = useState<{ x: number; y: number; row: Row } | null>(null);
  const [canvasCtx, setCanvasCtx] = useState<{ x: number; y: number } | null>(null);
  const [clip, setClip] = useState<{ id: string; name: string } | null>(null);
  const [viewFile, setViewFile] = useState<ViewFile | null>(null);
  const [editFile, setEditFile] = useState<ViewFile | null>(null);
  const [accounts, setAccounts] = useState<{ id: string; label: string; email: string | null; free: number | null; usage?: number | null; limit?: number | null; status: string }[]>([]);
  const [driveSel, setDriveSel] = useState(""); // "" = Auto (roomiest drive)
  const [driveView, setDriveView] = useState<{ accountId: string; folderId: string | null; path: { id: string; name: string }[] } | null>(null);
  const [tree, setTree] = useState<{ id: string; name: string; mime: string; size: number; googleId: string; parent: string | null }[] | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState<FileRow | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameTarget, setRenameTarget] = useState<{ kind: "file" | "folder"; id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);
  const [confirmFolderDelete, setConfirmFolderDelete] = useState<Folder | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const PAGE = 50;
  const [uploading, setUploading] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Clipboard survives reloads; silent 60s auto-refresh (no skeleton flash).
  const qRef = useRef(q);
  qRef.current = q;
  const lastGoogleError = useRef<string | null>(null);

  const nav = hist[hi];
  const curFolder = nav.kind === "root" ? nav.path[nav.path.length - 1] ?? null : null;

  const load = useCallback(async (query: string, from = 0, append = false, silent = false) => {
    if (append) setLoadingMore(true);
    else if (!silent) setLoading(true);
    try {
      const [fr, dr, br] = await Promise.all([
        append ? null : fetch("/api/folders").then(async (r) => {
          if (!r.ok) throw new Error(`folders ${r.status}`);
          return r.json();
        }),
        fetch(`/api/drive?q=${encodeURIComponent(query)}&limit=${PAGE}&offset=${from}`).then(async (r) => {
          if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            throw new Error((d as { error?: string }).error ?? `drive ${r.status}`);
          }
          return r.json();
        }),
        append ? null : fetch("/api/drive/bin").then(async (r) => {
          if (!r.ok) throw new Error(`bin ${r.status}`);
          return r.json();
        })
      ]);
      if (fr) setFolders(fr.results ?? []);
      setFiles((prev) => append ? [...prev, ...(dr.results ?? [])] : (dr.results ?? []));
      setHasMore((dr.results ?? []).length >= PAGE);
      if (br) { setBin(br.results ?? []); setCanPurge(!!br.canPurge); }
      if (dr.google_error && dr.google_error !== lastGoogleError.current) {
        lastGoogleError.current = dr.google_error;
        toast({ text: dr.google_error, tone: "err" });
      }
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "Couldn't reach the server.", tone: "err" });
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  function loadMore() {
    // Live Google rows (g:*) aren't in the index — offset counts indexed rows only.
    const indexed = files.filter((f) => !f.id.startsWith("g:")).length;
    load(q, indexed, true);
  }

  useEffect(() => {
    let dead = false;
    fetch("/api/drive/accounts").then((r) => r.json().catch(() => ({}))).then((d) => {
      if (!dead) setAccounts(d.results ?? []);
    }).catch(() => { /* picker stays hidden */ });
    return () => { dead = true; };
  }, []);

  useEffect(() => {
    try { const v = localStorage.getItem("eiden-upload-drive"); if (v) setDriveSel(v); } catch { /* ignore */ }
  }, []);
  // A remembered drive that no longer exists falls back to Auto.
  useEffect(() => { if (driveSel && accounts.length && !accounts.some((a) => a.id === driveSel)) setDriveSel(""); }, [accounts, driveSel]);
  function chooseUploadDrive(id: string) {
    setDriveSel(id);
    try { localStorage.setItem("eiden-upload-drive", id); } catch { /* ignore */ }
  }

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    try {
      const raw = localStorage.getItem("eiden-clip");
      if (raw) setClip(JSON.parse(raw));
    } catch { /* ignore */ }
    // Auto-refresh every 60s, silently: same call as manual Refresh but without
    // the skeleton flash (silent=true skips setLoading).
    const t = setInterval(() => loadRef.current(qRef.current, 0, false, true), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(q), q ? 350 : 0);
    return () => clearTimeout(t);
  }, [q, load]);

  useEffect(() => { setPane(window.matchMedia("(min-width: 768px)").matches); }, []);
  useEffect(() => {
    if (!ctx && !canvasCtx) return;
    const close = () => { setCtx(null); setCanvasCtx(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("click", close); window.addEventListener("scroll", close, true); window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); window.removeEventListener("keydown", esc); };
  }, [ctx, canvasCtx]);

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
    // Drive tree view: one account's Google folders/files from the index.
    if (driveView && nav.kind === "root" && !q.trim()) {
      if (!tree) return [];
      const acctLabel = accounts.find((a) => a.id === driveView.accountId)?.label ?? "Drive";
      const idSet = new Set(tree.map((t) => t.googleId));
      const kids = tree.filter((t) => driveView.folderId ? t.parent === driveView.folderId : (!t.parent || !idSet.has(t.parent)));
      const gFolders = kids.filter((k) => k.mime === "application/vnd.google-apps.folder");
      const gFiles = kids.filter((k) => k.mime !== "application/vnd.google-apps.folder");
      const toFile = (t: { id: string; name: string; mime: string; size: number; googleId: string }): FileRow =>
        ({ id: t.id ?? `g:${driveView.accountId}:${t.googleId}`, name: t.name, mime: t.mime, size: t.size, backends: ["google"], accountLabel: acctLabel, google_file_id: t.googleId });
      return [
        ...gFolders.map((g): Row => ({ key: `gdrive:${g.googleId}`, kind: "folder", id: `gdrive:${g.googleId}`, name: g.name, depth: 0, dept: null })),
        ...sortFiles(gFiles.map(toFile)).map((f) => fileRowOf(f, 0))
      ];
    }
    if (tagSel.length) {
      const n = q.trim().toLowerCase();
      const has = (kind: TagKind, id: string) => tagSel.every((t) => tg.idsOf(kind, id).includes(t));
      return [...sortFolders(folders.filter((f) => has("folder", f.id) && (!n || f.name.toLowerCase().includes(n)))).map((f) => folderRowOf(f, 0)),
        ...sortFiles(files.filter((f) => !f.id.startsWith("g:") && has("file", f.id) && (!n || f.name.toLowerCase().includes(n)))).map((f) => fileRowOf(f, 0))];
    }
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
  }, [nav.kind, files, folders, q, tagFilter, tagSel, tg.idsOf, sort, expanded, curFolder, deptOf, driveView, tree, accounts]);

  // Pagination: files/folders (list + grid) and the Recovery Bin page independently; any navigation/filter/sort resets to page 1.
  const pg = usePagination(rows, { defaultSize: 50, sizes: [25, 50, 100, 200], storageKey: "files",
    resetKey: `${nav.kind}|${nav.path.join("/")}|${q}|${tagSel.join(",")}|${tagFilter}|${driveView?.accountId}|${driveView?.folderId}|${sort.key}${sort.dir}` });
  const binPg = usePagination(bin, { defaultSize: 25, sizes: [10, 25, 50, 100], storageKey: "bin" });

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
    if (r.kind === "folder") {
      // Google-tree folders descend inside the drive view; local folders use history.
      if (r.id.startsWith("gdrive:")) {
        const gid = r.id.slice("gdrive:".length);
        const dv = driveView;
        if (dv) setDriveView({ ...dv, folderId: gid, path: [...dv.path, { id: gid, name: r.name }] });
        return;
      }
      go({ kind: "root", path: pathTo(r.id) });
      return;
    }
    // Double-click / Enter / Open = in-app preview for every file kind.
    if (r.file) setViewFile(toViewFile(r.file));
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

  // Click selection: plain = single, Ctrl/Cmd = toggle, Shift = range from anchor.
  function clickRow(e: React.MouseEvent, r: Row, idx: number) {
    e.stopPropagation();
    const items = pg.pageItems;
    if (e.shiftKey && anchorRef.current >= 0 && items.length) {
      const [a, b] = [anchorRef.current, idx].sort((x, y) => x - y);
      const range = items.slice(a, b + 1).map((x) => x.key);
      setSelKey(r.key);
      setMulti(range.filter((k) => k !== r.key));
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      anchorRef.current = idx;
      if (multi.includes(r.key)) {
        setMulti(multi.filter((k) => k !== r.key));
      } else if (selKey === r.key) {
        setSelKey(multi[0] ?? null);
        setMulti(multi.slice(1));
      } else {
        if (selKey) setMulti([...multi, selKey]);
        setSelKey(r.key);
      }
      return;
    }
    anchorRef.current = idx;
    setSelKey(r.key);
    setMulti([]);
  }

  const selRows = useMemo(
    () => rows.filter((r) => selSet.has(r.key) && r.kind === "file" && r.file && !r.id.startsWith("g:")),
    [rows, selSet]
  );

  async function bulkTrash() {
    setConfirmBulk(false);
    if (!selRows.length) return;
    let ok = 0;
    for (const r of selRows) {
      const res = await fetch("/api/drive/trash", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id: r.id }) });
      if (res.ok) ok++;
    }
    clearSel();
    toast({ text: ok === selRows.length ? `${ok} file${ok === 1 ? "" : "s"} moved to Recovery Bin.` : `${ok}/${selRows.length} trashed — the rest failed.`, tone: ok ? "ok" : "err" });
    load(q);
  }

  function bulkDownload() {
    const downs = selRows.filter((r) => r.file?.storage_path);
    if (!downs.length) { toast({ text: "Nothing downloadable — these need a Storage copy first.", tone: "err" }); return; }
    downs.forEach((r, i) => setTimeout(() => {
      const a = document.createElement("a");
      a.href = `/api/drive/download?file_id=${r.id}`;
      a.download = r.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }, i * 400));
    toast({ text: `Downloading ${downs.length} file${downs.length === 1 ? "" : "s"}…`, tone: "ok" });
    if (downs.length < selRows.length) toast({ text: "Google-only files were skipped — sync them for a local copy.", tone: "err" });
  }

  // Keyboard shortcuts (ignored while typing, viewing, or editing).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (viewFile || editFile) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "c") {
        const f = selRows[0]?.file;
        if (f) { e.preventDefault(); copyFile(f); }
      } else if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault(); pasteClip();
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        const keys = pg.pageItems.map((x) => x.key);
        if (keys.length) { setSelKey(keys[keys.length - 1]); setMulti(keys.slice(0, -1)); anchorRef.current = 0; }
      } else if ((e.key === "Delete" || e.key === "Backspace") && selSet.size > 0 && nav.kind !== "bin") {
        e.preventDefault(); setConfirmBulk(true);
      } else if (e.key === "Escape") {
        clearSel();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

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

  async function purge() {
    if (!confirmPurge || purging) return;
    setPurging(true);
    const r = await fetch("/api/drive/purge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id: confirmPurge.id }) });
    const d = await r.json().catch(() => ({}));
    setPurging(false);
    if (r.ok) {
      toast({ text: `"${confirmPurge.name}" deleted permanently.`, tone: "ok" });
      setBin((b) => b.filter((x) => x.file_id !== confirmPurge.id));
      setSelKey(null); setConfirmPurge(null); load(q, 0, false, true);
    } else { toast({ text: d.error ?? "Couldn't delete the file.", tone: "err" }); setConfirmPurge(null); }
  }

  async function restore(id: string, name: string) {
    const r = await fetch("/api/drive/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id: id }) });
    if (r.ok) { toast({ text: `"${name}" restored.`, tone: "ok" }); setSelKey(null); load(q); }
    else toast({ text: "Restore needs a Manager account.", tone: "err" });
  }

  async function createFolder(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || folderBusy) return;
    setFolderBusy(true);
    const r = await fetch("/api/folders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, parent: curFolder }) });
    setFolderBusy(false);
    if (r.ok) { toast({ text: `Folder "${name}" created.`, tone: "ok" }); setNewName(""); setShowNewFolder(false); load(q); }
    else toast({ text: "Couldn't create folder.", tone: "err" });
  }

  async function uploadPicked(list: FileList | null) {
    const files = list ? Array.from(list) : [];
    if (!files.length) return;
    let ok = 0;
    for (const file of files) {
      setUploading(files.length > 1 ? `${file.name} (${ok + 1}/${files.length})` : file.name);
      try {
        const hash = await sha256(file);
        const init = await fetch("/api/drive/upload-url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: file.name, mime: file.type || "application/octet-stream", size: file.size }) });
        const dj = await init.json();
        if (!init.ok) throw new Error(dj.error ?? "upload init failed");
        const put = await fetch(dj.signedUrl, { method: "PUT", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
        if (!put.ok) throw new Error("byte upload failed");
        const meta = await fetch("/api/drive/upload", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: file.name, mime: file.type || "application/octet-stream", size: file.size, hash, backends: ["local"], storage_path: dj.path, folder: curFolder, drive_account: driveSel || undefined })
        });
        const mj = await meta.json().catch(() => ({}));
        if (!meta.ok) throw new Error(mj.error ?? "indexing failed");
        if (mj.push_error) toast({ text: `"${file.name}" saved locally — Google mirror skipped: ${mj.push_error}`, tone: "err" });
        ok++;
      } catch (e) {
        toast({ text: `"${file.name}": ${e instanceof Error ? e.message : "upload failed."}`, tone: "err" });
      }
    }
    setUploading(null);
    if (fileRef.current) fileRef.current.value = "";
    if (ok === files.length) toast({ text: files.length === 1 ? `"${files[0].name}" uploaded and indexed.` : `${ok} files uploaded and indexed.`, tone: "ok" });
    else if (ok > 0) toast({ text: `${ok}/${files.length} uploaded — the rest failed.`, tone: "err" });
    load(q);
  }

  function copyLink(r: Row) {
    const url = `${window.location.origin}/drive/${r.id}`;
    navigator.clipboard?.writeText(url).then(() => toast({ text: "Link copied.", tone: "ok" }), () => toast({ text: "Couldn't copy link.", tone: "err" }));
  }

  function openRename(kind: "file" | "folder", id: string, name: string) {
    setRenameTarget({ kind, id, name });
    setRenameValue(name);
    setCtx(null);
  }

  async function doRename(e: React.FormEvent) {
    e.preventDefault();
    if (!renameTarget || renameBusy) return;
    const name = renameValue.trim();
    if (!name || name === renameTarget.name) { setRenameTarget(null); return; }
    setRenameBusy(true);
    const url = renameTarget.kind === "folder" ? "/api/folders" : "/api/drive/rename";
    const body = renameTarget.kind === "folder"
      ? { folder_id: renameTarget.id, name }
      : { file_id: renameTarget.id, name };
    const r = await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    setRenameBusy(false);
    if (r.ok) { toast({ text: `Renamed to "${name}".`, tone: "ok" }); setRenameTarget(null); load(q); }
    else toast({ text: d.error ?? "Couldn't rename.", tone: "err" });
  }

  async function deleteFolder() {
    if (!confirmFolderDelete) return;
    const r = await fetch("/api/folders", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ folder_id: confirmFolderDelete.id }) });
    const d = await r.json().catch(() => ({}));
    setConfirmFolderDelete(null);
    if (r.ok) { toast({ text: `Folder "${confirmFolderDelete.name}" deleted.`, tone: "ok" }); setSelKey(null); load(q); }
    else toast({ text: d.error ?? "Couldn't delete folder.", tone: "err" });
  }

  async function syncGoogle() {
    setSyncing(true);
    try {
      // Per account: chain that account's pages, then move to the next account
      // the server names (nextAccountId). One page per request per account —
      // no request ever walks a whole drive (HTTP 502-proof).
      const accts = accounts.length ? accounts : [{ id: "", label: "Primary" }];
      let ins = 0, upd = 0, pages = 0;
      const labels: string[] = [];
      for (const a of accts) {
        let token: string | null = null;
        for (let guard = 0; guard < 51; guard++) {
          const body: { pageToken: string | null; accountId?: string } = { pageToken: token };
          if (a.id) body.accountId = a.id;
          const r: Response = await fetch("/api/drive/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
          const d: { inserted?: number; updated?: number; done?: boolean; nextPageToken?: string | null; nextAccountId?: string | null; accountLabel?: string; error?: string } = await r.json().catch(() => ({}));
          if (!r.ok) { toast({ text: d.error ?? "Sync failed.", tone: "err" }); return; }
          ins += d.inserted ?? 0; upd += d.updated ?? 0; pages++;
          if (d.accountLabel && !labels.includes(d.accountLabel)) labels.push(d.accountLabel);
          if (d.done) break;
          // Server-driven hop: done with this account but another remains.
          if (d.nextAccountId && d.nextAccountId !== a.id) break;
          token = d.nextPageToken ?? null;
          if (!token) break;
        }
      }
      toast({ text: `Google sync done${labels.length ? ` (${labels.join(" + ")})` : ""}: ${ins} new, ${upd} updated (${pages} page${pages === 1 ? "" : "s"}).`, tone: "ok" });
      load(q);
    } finally {
      setSyncing(false);
    }
  }

  // Drive tree data: fetched once per opened drive (folders + files, capped).
  useEffect(() => {
    if (!driveView) { setTree(null); return; }
    let dead = false;
    setTree(null);
    setTreeLoading(true);
    fetch(`/api/drive/tree?accountId=${driveView.accountId}`)
      .then((r) => r.json().catch(() => ({})))
      .then((d) => {
        if (dead) return;
        setTree((d.results ?? []).map((t: { id: string; name: string; mime: string; size: number; google_file_id: string; google_parent_id: string | null }) => ({
          id: t.id, name: t.name, mime: t.mime, size: t.size ?? 0, googleId: t.google_file_id, parent: t.google_parent_id
        })));
        setTreeLoading(false);
      })
      .catch(() => { if (!dead) setTreeLoading(false); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveView?.accountId]);

  function openDrive(accountId: string) {
    if (nav.kind !== "root" || nav.path.length) go({ kind: "root", path: [] });
    setTagSel([]); setTagFilter(null); setQ("");
    setDriveView({ accountId, folderId: null, path: [] });
    setSelKey(null); setInfoOpen(false); setCtx(null);
  }
  const taggable = (r: Row) => (r.kind === "file" ? !r.id.startsWith("g:") : !r.id.startsWith("gdrive:"));
  const rowTags = (r: Row): Tag[] => taggable(r) ? tg.idsOf(r.kind, r.id).map((id) => tg.byId.get(id)).filter(Boolean) as Tag[] : [];
  function toggleTagFilter(id: string) {
    setDriveView(null);
    setTagFilter(null);
    if (nav.kind !== "root") go({ kind: "root", path: [] });
    setTagSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    setSelKey(null);
  }

  function copyFile(f: FileRow) {
    const c = { id: f.id, name: f.name };
    setClip(c);
    try { localStorage.setItem("eiden-clip", JSON.stringify(c)); } catch { /* ignore */ }
    toast({ text: `Copied "${f.name}" — right-click → Paste to duplicate it.`, tone: "ok" });
  }

  async function pasteClip() {
    if (!clip) return;
    const r = await fetch("/api/drive/copy", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ file_id: clip.id, folder: curFolder })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast({ text: d.error ?? "Couldn't paste.", tone: "err" }); return; }
    toast({ text: `Pasted as "${d.name}".`, tone: "ok" });
    load(q);
  }

  function toViewFile(f: FileRow): ViewFile {
    // googleId resolution order: indexed column → live g: id suffix.
    let googleId: string | null = f.google_file_id ?? null;
    if (!googleId && f.id.startsWith("g:")) {
      const rest = f.id.slice(2);
      const i = rest.indexOf(":");
      googleId = i >= 0 ? rest.slice(i + 1) : rest;
    }
    return { id: f.id, name: f.name, mime: f.mime, size: f.size, backends: f.backends, googleId };
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
        <button onClick={() => setFavOpen((o) => !o)} aria-expanded={favOpen} className="flex items-center justify-between px-2 min-h-[44px] text-[13px] text-muted">
          Favorites {favOpen ? <ChevronDown size={16} className="text-brand" /> : <ChevronRight size={16} className="text-brand" />}
        </button>
        {favOpen && (
          <div className="flex flex-col gap-1 mb-2">
            {favItem(nav.kind === "recent", () => go({ kind: "recent", path: [] }), <Clock size={19} strokeWidth={1.6} />, "Recent")}
            {favItem(nav.kind === "docs", () => go({ kind: "docs", path: [] }), <FileText size={19} strokeWidth={1.6} />, "Documents")}
            {favItem(nav.kind === "bin", () => go({ kind: "bin", path: [] }), <Trash2 size={19} strokeWidth={1.6} />, "Recovery Bin", bin.length)}
            {favItem(nav.kind === "root" && !tagFilter && tagSel.length === 0 && !driveView, () => { setDriveView(null); setTagSel([]); setTagFilter(null); go({ kind: "root", path: [] }); }, <House size={19} strokeWidth={1.6} />, "Root")}
          </div>
        )}
        {/* Drives: every connected Google account, with live free space. Click = browse that drive. */}
        <div className="mt-1 flex items-center justify-between px-2 min-h-[44px]">
          <button onClick={() => setDrivesOpen((o) => !o)} aria-expanded={drivesOpen} className="flex items-center gap-1 text-[13px] text-muted">
            Drives {accounts.length > 0 && <span className="text-[11px] tabular-nums">· {accounts.length}</span>}
            {drivesOpen ? <ChevronDown size={16} className="text-brand" /> : <ChevronRight size={16} className="text-brand" />}
          </button>
          <a href="/storage" className="text-[11.5px] text-brand hover:underline min-h-[44px] inline-flex items-center" title="Connect, scope or disconnect drives">Manage</a>
        </div>
        {drivesOpen && (
          <div className="flex flex-col gap-0.5 mb-2 max-h-[300px] overflow-y-auto shrink-0">
            {accounts.length === 0 && <p className="px-3 py-2 text-[12px] text-muted leading-snug">No Google drive connected. Ask an admin to connect one in Storage.</p>}
            {accounts.filter((a) => a.status === "active").map((a) => {
              const on = driveView?.accountId === a.id;
              const total = a.limit ?? null;
              const used = a.usage ?? null;
              const pct = total && used !== null ? Math.min(100, Math.round((used / total) * 100)) : null;
              return (
                <button key={a.id} onClick={() => openDrive(a.id)} aria-current={on ? "page" : undefined} title={a.email ?? a.label}
                  className={`relative w-full rounded-md px-3 py-2 text-left flex items-center gap-3 transition-colors ${on ? "bg-tint text-brand" : "hover:bg-tint/60"} ${a.status !== "active" ? "opacity-60" : ""}`}>
                  {on && <span className="absolute -left-1 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r bg-brand" />}
                  <span className={`size-8 rounded-lg grid place-items-center shrink-0 ${on ? "bg-brand text-white" : "bg-tint text-brand"}`} aria-hidden="true"><HardDrive size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[13.5px] leading-tight truncate ${on ? "font-medium" : "text-ink"}`}>{a.label}</span>
                    {pct !== null ? (
                      <span className="mt-1 block h-1 rounded-full bg-line overflow-hidden" role="img" aria-label={`${pct}% used`}>
                        <span className={`block h-full rounded-full ${pct >= 95 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-brand"}`} style={{ width: `${pct}%` }} />
                      </span>
                    ) : null}
                    <span className="block mt-0.5 text-[10.5px] text-muted truncate">
                      {a.status !== "active" ? (a.status === "down" ? "Unreachable" : "Disabled") : a.free !== null ? `${formatBytes(a.free)} free` : "Quota not reported"}
                    </span>
                  </span>
                </button>
              );
            })}
            {accounts.some((a) => a.status !== "active") && (
              <p className="px-3 py-1.5 text-[11px] text-muted">
                {accounts.filter((a) => a.status !== "active").length} disabled — re-enable in Storage to browse {accounts.filter((a) => a.status !== "active").length === 1 ? "it" : "them"} again.
              </p>
            )}
          </div>
        )}

        {/* Tags: create, attach (right-click → Tags…, or the details panel), filter. */}
        <div className="mt-1 flex items-center justify-between px-2 min-h-[44px]">
          <button onClick={() => setTagsOpen((o) => !o)} aria-expanded={tagsOpen} className="flex items-center gap-1 text-[13px] text-muted">
            Tags {tagsOpen ? <ChevronDown size={16} className="text-brand" /> : <ChevronRight size={16} className="text-brand" />}
          </button>
          <span className="flex items-center gap-1">
            {tagSel.length > 0 && <button onClick={() => setTagSel([])} className="text-[11.5px] text-brand hover:underline min-h-[44px] px-1">Clear</button>}
            <button onClick={() => setTagEditor({})} aria-label="New tag" title="New tag"
              className="size-8 grid place-items-center rounded-md text-brand hover:bg-tint"><Plus size={17} /></button>
          </span>
        </div>
        {tagsOpen && (
          <div className="flex flex-col gap-0.5 shrink-0">
            {tg.ready && tg.tags.length === 0 && (
              <div className="px-3 py-2">
                <p className="text-[12px] text-muted leading-snug">Tags label files and folders so you can filter them across every drive.</p>
                <button onClick={() => setTagEditor({})} className="mt-2 min-h-[44px] px-3 rounded-md bg-tint text-brand text-[13px] font-medium inline-flex items-center gap-1.5"><Plus size={15} /> Create your first tag</button>
              </div>
            )}
            {tg.tags.map((t) => {
              const on = tagSel.includes(t.id);
              return (
                <div key={t.id} className="group relative">
                  <button onClick={() => toggleTagFilter(t.id)} aria-pressed={on}
                    className={`w-full min-h-[44px] pl-3 pr-9 rounded-md flex items-center gap-3 text-[14.5px] text-left transition-colors ${on ? "bg-tint text-brand font-medium" : "text-ink/85 hover:bg-tint/60"}`}>
                    <span className="size-3 rounded-full shrink-0 grid place-items-center" style={{ background: t.color }}>{on && <Check size={9} className="text-white" strokeWidth={4} />}</span>
                    <span className="flex-1 truncate">{t.name}</span>
                    <span className="text-[11px] text-muted tabular-nums group-hover:opacity-0 group-focus-within:opacity-0">{tg.counts.get(t.id) ?? 0}</span>
                  </button>
                  <span className="absolute right-0.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                    <Menu label={`Tag options for ${t.name}`} align="right" trigger={<MoreHorizontal size={16} className="text-muted" />}
                      items={[
                        { label: "Edit tag…", icon: <Pencil size={14} />, onSelect: () => setTagEditor({ tag: t }) },
                        { label: "Delete tag", icon: <Trash2 size={14} />, danger: true, onSelect: () => setConfirmTagDel(t) }
                      ]} />
                  </span>
                </div>
              );
            })}
            {tagSel.length > 1 && <p className="px-3 pt-1 text-[11px] text-muted">Showing items with all {tagSel.length} tags.</p>}
          </div>
        )}

        {/* Departments: set by managers on folders; read-only filter. */}
        {depts.length > 0 && (
          <>
            <button onClick={() => setDeptOpen((o) => !o)} aria-expanded={deptOpen} className="mt-1 flex items-center justify-between px-2 min-h-[44px] text-[13px] text-muted">
              Departments {deptOpen ? <ChevronDown size={16} className="text-brand" /> : <ChevronRight size={16} className="text-brand" />}
            </button>
            {deptOpen && (
              <div className="flex flex-col gap-0.5 shrink-0">
                {depts.map((d) => (
                  <button key={d} onClick={() => { if (tagFilter === d) setTagFilter(null); else { setTagSel([]); setDriveView(null); if (nav.kind !== "root" || nav.path.length) go({ kind: "root", path: [] }); setTagFilter(d); setSelKey(null); } }}
                    aria-pressed={tagFilter === d}
                    className={`w-full min-h-[44px] pl-3 pr-3 rounded-md flex items-center gap-3 text-[14.5px] text-left transition-colors ${tagFilter === d ? "bg-tint text-brand font-medium" : "text-ink/85 hover:bg-tint/60"}`}>
                    <span className="size-3 rounded-sm shrink-0" style={{ background: tagColor(d) ?? undefined }} />
                    <span className="truncate">{d}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Toolbar */}
        <div className="shrink-0 min-h-[56px] px-3 flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
          <button onClick={() => setPane((p) => !(p ?? true))} aria-label="Toggle favorites pane" className="size-11 grid place-items-center rounded-md hover:bg-tint"><MenuIcon size={21} strokeWidth={1.6} /></button>
          <span className="h-5 border-l border-line mx-1" />
          <button onClick={back} disabled={hi === 0} aria-label="Back" className="size-11 grid place-items-center rounded-md bg-tint text-brand disabled:opacity-40"><ChevronLeft size={18} /></button>
          <button onClick={forward} disabled={hi >= hist.length - 1} aria-label="Forward" className="size-11 grid place-items-center rounded-md bg-tint text-brand disabled:opacity-40"><ChevronRight size={18} /></button>
          <h2 className="ml-2 text-[16px] text-ink/90 truncate max-w-[40%]">{title}</h2>

          <div className="ml-auto flex items-center gap-1.5">
            <div className="relative">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search files"
                className="w-32 sm:w-52 min-h-[44px] pl-8 pr-2 rounded-md border border-line bg-surface text-[13px] placeholder:text-muted focus:border-brand focus:outline-none" />
            </div>
            <div role="group" aria-label="View" className="flex rounded-md overflow-hidden">
              <button onClick={() => setView("list")} aria-pressed={view === "list"} aria-label="List view" className={`size-11 grid place-items-center ${view === "list" ? "bg-tint text-brand" : "text-muted hover:bg-tint/60"}`}><LayoutList size={19} strokeWidth={1.6} /></button>
              <button onClick={() => setView("grid")} aria-pressed={view === "grid"} aria-label="Grid view" className={`size-11 grid place-items-center ${view === "grid" ? "bg-tint text-brand" : "text-muted hover:bg-tint/60"}`}><LayoutGrid size={19} strokeWidth={1.6} /></button>
            </div>
            <span className="h-5 border-l border-line mx-0.5" />
            {/* Upload: one pill, two equal-height segments (action | destination). */}
            <div className="flex items-stretch h-11 rounded-lg bg-brand text-white shadow-[0_1px_2px_rgba(60,30,140,.3)]">
              <button onClick={() => fileRef.current?.click()} disabled={!!uploading}
                title={driveSel ? `Uploads mirror to ${accounts.find((a) => a.id === driveSel)?.label ?? "the chosen drive"}` : accounts.length > 1 ? "Uploads mirror to the drive with the most free space" : "Upload a file"}
                className={`px-3.5 flex items-center gap-2 text-[13.5px] font-medium hover:bg-white/12 active:bg-white/20 disabled:opacity-60 transition-colors ${accounts.length > 1 ? "rounded-l-lg" : "rounded-lg"}`}>
                <Upload size={16} strokeWidth={2.2} /> <span className="hidden sm:inline">{uploading ? "Uploading…" : "Upload"}</span>
              </button>
              {accounts.length > 1 && (
                <>
                  <span className="my-2.5 w-px bg-white/30" aria-hidden="true" />
                  <Menu label="Choose upload drive" align="right" rootClassName="h-full"
                    triggerClassName="h-full w-9 grid place-items-center rounded-r-lg hover:bg-white/12 active:bg-white/20 transition-colors"
                    trigger={<ChevronDown size={15} strokeWidth={2.4} />}
                    items={[
                      { label: `Auto · most free space${(() => { const r = [...accounts].filter((a) => a.status === "active").sort((x, y) => (y.free ?? -1) - (x.free ?? -1))[0]; return r ? ` (${r.label})` : ""; })()}`,
                        icon: driveSel === "" ? <Check size={14} /> : undefined, onSelect: () => chooseUploadDrive("") },
                      "sep",
                      ...accounts.filter((a) => a.status === "active").map((a) => ({
                        label: `${a.label} · ${a.free !== null ? `${formatBytes(a.free)} free` : "quota unknown"}`,
                        icon: driveSel === a.id ? <Check size={14} /> : undefined, onSelect: () => chooseUploadDrive(a.id)
                      }))
                    ]} />
                </>
              )}
            </div>
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
                { label: "New folder", icon: <FolderPlus size={14} />, onSelect: () => setShowNewFolder(true), hidden: nav.kind !== "root" },
                "sep",
                { label: syncing ? "Syncing from Google…" : "Sync from Google", icon: <CloudDownload size={14} />, onSelect: syncGoogle },
                { label: "Refresh", icon: <RefreshCw size={14} />, onSelect: () => load(q) }
              ]} />
            <input ref={fileRef} type="file" multiple className="hidden" aria-label="Choose files to upload" onChange={(e) => uploadPicked(e.target.files)} />
          </div>
        </div>

        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="shrink-0 h-8 px-3 flex items-center gap-1.5 text-[12px] text-ink/80 border-t border-line overflow-x-auto whitespace-nowrap">
          {crumbs.map((c, i) => (
            <span key={`${c.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight size={11} className="text-muted/70" />}
              {i === 0 ? <House size={13} className="text-brand" /> : c.folder ? <FolderIcon size={14} /> : null}
              {c.onClick ? <button onClick={c.onClick} className="hover:text-brand min-h-[24px]">{c.label}</button> : <span aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c.label}</span>}
            </span>
          ))}
        </nav>

        {/* Body */}
        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Inside a drive: breadcrumb back through its folders. */}
            {!loading && driveView && nav.kind === "root" && !q.trim() && (
              <div className="shrink-0 px-3 pt-2 flex items-center gap-1.5 text-[12.5px] overflow-x-auto whitespace-nowrap" aria-label="Drive location">
                <button onClick={() => setDriveView(null)} className="text-brand font-medium min-h-[36px] px-1">Drives</button>
                <ChevronRight size={12} className="text-muted shrink-0" />
                <button onClick={() => setDriveView({ ...driveView, folderId: null, path: [] })}
                  className={`min-h-[36px] px-1 ${driveView.path.length === 0 ? "font-medium" : "hover:text-brand"}`}>
                  {accounts.find((a) => a.id === driveView.accountId)?.label ?? "Drive"}
                </button>
                {driveView.path.map((p, i) => (
                  <span key={p.id} className="flex items-center gap-1.5">
                    <ChevronRight size={12} className="text-muted shrink-0" />
                    <button
                      onClick={() => i < driveView.path.length - 1 && setDriveView({ ...driveView, folderId: p.id, path: driveView.path.slice(0, i + 1) })}
                      className={`min-h-[36px] px-1 ${i === driveView.path.length - 1 ? "font-medium" : "hover:text-brand"}`}>
                      {p.name}
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative flex-1 min-h-0 overflow-auto"
              onClick={() => { clearSel(); setInfoOpen(false); }}
              onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer.types.includes("Files")) setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files.length) uploadPicked(e.dataTransfer.files);
              }}
              onContextMenu={(e) => {
                // Canvas menu — rows stop propagation and show the file menu instead.
                e.preventDefault();
                setSelKey(null); setInfoOpen(false); setCtx(null);
                setCanvasCtx({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 220) });
              }}>
              {dragOver && (
                <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-lg border-2 border-dashed border-brand bg-brand/5" role="status">
                  <p className="px-4 py-2 rounded-md bg-surface border border-line text-[14px] font-medium">Drop to upload</p>
                </div>
              )}
              {loading || (driveView && treeLoading) ? (
                <div aria-busy="true" aria-label="Loading files" className="p-4 flex flex-col gap-2">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="skel size-6 shrink-0" />
                      <span className="skel h-4 flex-1" />
                      <span className="skel h-4 w-16 hidden md:block" />
                      <span className="skel h-4 w-20 hidden md:block" />
                    </div>
                  ))}
                  <span className="sr-only" role="status">Reading drive…</span>
                </div>
              ) : nav.kind === "bin" ? (
                bin.length === 0
                  ? <EmptyState title="Recovery Bin is empty" body="Deleted files rest here for 90 days. Members can never delete permanently." />
                  : (
                    <ul className="divide-y divide-line">
                      {binPg.pageItems.map((b) => {
                        const fi = Array.isArray(b.file_index) ? b.file_index[0] : b.file_index;
                        const id = fi?.id ?? b.file_id;
                        return (
                          <li key={b.file_id} onClick={(e) => { e.stopPropagation(); setSelKey(id); }}
                            className={`px-4 min-h-[44px] flex items-center gap-3 text-[14px] cursor-default ${selKey === id ? "bg-tint text-brand" : "hover:bg-tint/50"}`}>
                            <FileIcon name={fi?.name ?? ""} mime={fi?.mime} size={26} />
                            <span className="flex-1 truncate">{fi?.name}</span>
                            <span className="text-[11px] text-muted hidden sm:block">purges {fmtDate(b.purge_at)}</span>
                            <button onClick={(e) => { e.stopPropagation(); restore(b.file_id, fi?.name ?? "?"); }} className="min-h-[44px] px-2 text-[12px] text-brand flex items-center gap-1 hover:underline"><Undo2 size={14} /> Restore</button>
                            {canPurge && <button onClick={(e) => { e.stopPropagation(); setConfirmPurge({ id: b.file_id, name: fi?.name ?? "file" }); }} aria-label={`Delete ${fi?.name ?? "file"} permanently`} title="Delete permanently" className="size-11 grid place-items-center rounded-md text-muted hover:text-danger hover:bg-danger/10 transition-colors"><Trash2 size={16} /></button>}
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
                  {pg.pageItems.map((r, ri) => {
                    const on = selSet.has(r.key);
                    const cls = r.file ? classify(r.file.name, r.file.mime) : "";
                    return (
                      <div key={r.key} role="row" tabIndex={0} aria-selected={on}
                        onClick={(e) => clickRow(e, r, ri)}
                        onDoubleClick={() => open(r)}
                        onKeyDown={(e) => onRowKey(e, r)}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSelKey(r.key); setCtx({ x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 260), row: r }); }}
                        className={`frow min-h-[36px] px-4 border-b border-line/70 cursor-default select-none transition-colors ${on ? "bg-tint text-brand" : "hover:bg-tint/40"}`}>
                        <div role="gridcell" className="flex items-center gap-2 min-w-0" style={{ paddingLeft: r.depth * 20 }}>
                          {r.kind === "folder" && r.expandable
                            ? <button onClick={(e) => { e.stopPropagation(); toggleExpand(r.id); }} aria-label={expanded.has(r.id) ? `Collapse ${r.name}` : `Expand ${r.name}`} aria-expanded={expanded.has(r.id)}
                                className="size-[18px] grid place-items-center text-muted hover:text-brand shrink-0">{expanded.has(r.id) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
                            : <span className="w-[18px] shrink-0" />}
                          <FileIcon name={r.name} mime={r.file?.mime} folder={r.kind === "folder"} size={26} className="shrink-0" />
                          <span className="text-[15px] truncate">{r.name}</span>
                        </div>
                        <div role="gridcell" className="frow-hide"><TagDots tags={rowTags(r)} /></div>
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
                  {pg.pageItems.map((r, ri) => {
                    const on = selSet.has(r.key);
                    const cls = r.file ? classify(r.file.name, r.file.mime) : "";
                    return (
                      <button key={r.key} role="gridcell" aria-selected={on}
                        onClick={(e) => clickRow(e, r, ri)}
                        onDoubleClick={() => open(r)}
                        onKeyDown={(e) => onRowKey(e, r)}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSelKey(r.key); setCtx({ x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 260), row: r }); }}
                        className={`flex flex-col items-center gap-2 p-3 rounded-lg text-center transition-colors min-h-[104px] ${on ? "bg-tint text-brand" : "hover:bg-tint/40"}`}>
                        <FileIcon name={r.name} mime={r.file?.mime} folder={r.kind === "folder"} size={64} />
                        <span className="text-[12.5px] leading-tight break-all line-clamp-2">{r.name}</span>
                        {rowTags(r).length > 0 && <TagDots tags={rowTags(r)} />}
                      </button>
                    );
                  })}
                </div>
              )}
              {hasMore && !loading && nav.kind !== "bin" && pg.page === pg.pages && (
                <div className="p-4 grid place-items-center">
                  <button onClick={loadMore} disabled={loadingMore}
                    className="min-h-[44px] px-6 rounded-md border border-line text-sm hover:bg-tint disabled:opacity-50">
                    {loadingMore ? "Loading…" : "Load more"}
                  </button>
                </div>
              )}
            </div>
            <div className="shrink-0 border-t border-line px-3 empty:hidden"><Pagination pager={nav.kind === "bin" ? binPg : pg} noun={nav.kind === "bin" ? "files" : "items"} /></div>
            <p className="shrink-0 h-8 px-4 flex items-center text-[11px] text-muted border-t border-line" role="status">
              {nav.kind === "bin" ? `${bin.length} in bin` : `${folderCount} folders · ${fileRows.length} files · ${formatBytes(totalSize)}`}
            </p>
          </div>
          {/* Bulk action bar */}
          {selSet.size > 1 && (
            <div className="shrink-0 px-3 py-2 border-t border-line bg-surface flex items-center gap-2" role="toolbar" aria-label={`${selSet.size} selected`}>
              <span className="text-[13px] font-medium">{selSet.size} selected</span>
              <span className="flex-1" />
              <button onClick={bulkDownload} className="min-h-[40px] px-3 rounded-md border border-line text-[13px] hover:bg-tint">Download</button>
              {nav.kind !== "bin" && (
                <button onClick={() => setConfirmBulk(true)} className="min-h-[40px] px-3 rounded-md border border-danger/40 text-danger text-[13px]">Trash</button>
              )}
              <button onClick={clearSel} className="min-h-[40px] px-3 rounded-md text-[13px] text-muted hover:bg-tint">Clear</button>
            </div>
          )}

          {/* Details */}
          {showInfo && sel && (
            <aside aria-label="Details"
              className="fixed lg:static inset-x-0 bottom-0 z-30 lg:z-auto max-h-[75vh] lg:max-h-none w-full lg:w-[296px] shrink-0 overflow-y-auto bg-surface border-t lg:border-t-0 lg:border-l border-line rounded-t-2xl lg:rounded-none shadow-pop lg:shadow-none p-4 flex flex-col pop-in">
              <button onClick={() => { setSelKey(null); setInfoOpen(false); }} aria-label="Close details" className="self-end -mt-1 -mr-1 mb-1 size-11 grid place-items-center rounded-md hover:bg-tint text-muted"><X size={16} /></button>
              <div className="h-[200px] rounded-lg border border-line bg-soft grid place-items-center overflow-hidden">
                {sel.file && classify(sel.file.name, sel.file.mime) === "IMAGE" && !sel.id.startsWith("g:")
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={`/api/drive/download?file_id=${sel.id}`} alt={`Preview of ${sel.name}`} loading="lazy" className="max-h-full max-w-full object-contain" />
                  : <FileIcon name={sel.name} mime={sel.file?.mime} folder={sel.kind === "folder"} size={132} />}
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
                  ...(sel.file?.accountLabel ? [["Drive", sel.file.accountLabel] as [string, string] ] : []),
                  ["Owner", sel.file?.owner ? `${sel.file.owner.slice(0, 8)}…` : "--"],
                  ["SHA-256", sel.file?.hash ? `${sel.file.hash.slice(0, 12)}…` : "--"]
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3 py-2.5 border-b border-line">
                    <dt className="text-ink/80">{k} :</dt><dd className="text-[11px] text-ink/75 text-right truncate">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-3">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] text-ink/80">Tags</p>
                  {taggable(sel) && nav.kind !== "bin" && (
                    <button onClick={() => setTagPicker({ kind: sel.kind, id: sel.id, name: sel.name })}
                      className="min-h-[36px] px-2 -mr-2 text-[12px] text-brand font-medium inline-flex items-center gap-1 hover:underline"><Plus size={13} /> Add tag</button>
                  )}
                </div>
                <div className="mt-1 flex gap-1.5 flex-wrap">
                  {rowTags(sel).map((t) => <TagChip key={t.id} tag={t} onRemove={nav.kind === "bin" ? undefined : () => tg.assign(sel.kind, sel.id, t.id, false)} />)}
                  {rowTags(sel).length === 0 && <span className="text-[11.5px] text-muted">{taggable(sel) ? "No tags yet" : "Tags apply to indexed files"}</span>}
                </div>
                {sel.dept && <p className="mt-2 text-[11.5px] text-muted">Department: <span className="text-ink/80">{sel.dept}</span></p>}
              </div>
              <div className="mt-auto pt-6 flex items-center justify-center divide-x divide-line text-ink/80">
                {sel.kind === "file" && !sel.id.startsWith("g:") && nav.kind !== "bin" && (
                  <button onClick={() => router.push(`/drive/${sel.id}`)} aria-label="Open" className="px-4 min-h-[44px] hover:text-brand"><ExternalLink size={19} strokeWidth={1.6} /></button>
                )}
                {sel.kind === "file" && !sel.id.startsWith("g:") && (
                  <a href={`/api/drive/download?file_id=${sel.id}`} aria-label="Download" className="px-4 min-h-[44px] grid place-items-center hover:text-brand"><Download size={19} strokeWidth={1.6} /></a>
                )}
                {sel.kind === "file" && nav.kind === "bin" && (
                  <button onClick={() => restore(sel.id, sel.name)} aria-label="Restore" className="px-4 min-h-[44px] hover:text-brand"><Undo2 size={19} strokeWidth={1.6} /></button>
                )}
                {sel.kind === "file" && nav.kind === "bin" && canPurge && (
                  <button onClick={() => setConfirmPurge({ id: sel.id, name: sel.name })} aria-label="Delete permanently" title="Delete permanently" className="px-4 min-h-[44px] text-muted hover:text-danger"><Trash2 size={19} strokeWidth={1.6} /></button>
                )}
                {sel.kind === "file" && !sel.id.startsWith("g:") && nav.kind !== "bin" && sel.file && (
                  <button onClick={() => setConfirmTrash(sel.file!)} aria-label="Move to Recovery Bin" className="px-4 min-h-[44px] hover:text-danger"><Trash2 size={19} strokeWidth={1.6} /></button>
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
            { label: "Open", on: () => open(ctx.row), show: ctx.row.kind === "file" },
            { label: "View", icon: <Eye size={14} />, on: () => ctx.row.file && setViewFile(toViewFile(ctx.row.file)), show: ctx.row.kind === "file" },
            { label: "Edit", icon: <Pencil size={14} />, on: () => ctx.row.file && setEditFile(toViewFile(ctx.row.file)),
              show: ctx.row.kind === "file" && !!ctx.row.file && !ctx.row.id.startsWith("g:") && editable(ctx.row.file.name, ctx.row.file.mime) },
            { label: "Copy", icon: <Copy size={14} />, on: () => ctx.row.file && copyFile(ctx.row.file),
              show: ctx.row.kind === "file" && !!ctx.row.file && !ctx.row.id.startsWith("g:") },
            { label: "Get Info", icon: <Info size={14} />, on: () => { setSelKey(ctx.row.key); setInfoOpen(true); }, show: true },
            { label: "Tags…", icon: <TagIcon size={14} />, on: () => setTagPicker({ kind: ctx.row.kind, id: ctx.row.id, name: ctx.row.name }), show: taggable(ctx.row) },
            { label: "Rename", icon: <Pencil size={14} />, on: () => ctx.row.kind === "folder" && ctx.row.folder
              ? openRename("folder", ctx.row.folder.id, ctx.row.folder.name)
              : ctx.row.file && openRename("file", ctx.row.id, ctx.row.file.name),
              show: ctx.row.kind === "folder" || (ctx.row.kind === "file" && !ctx.row.id.startsWith("g:")) },
            { label: "Download", icon: <Download size={14} />, on: () => { window.location.href = `/api/drive/download?file_id=${ctx.row.id}`; }, show: ctx.row.kind === "file" && !ctx.row.id.startsWith("g:") },
            { label: "Copy link", icon: <Link2 size={14} />, on: () => copyLink(ctx.row), show: !ctx.row.id.startsWith("g:") && ctx.row.kind === "file" },
            { label: "Delete", icon: <Trash2 size={14} />, danger: true, on: () => ctx.row.file && setConfirmTrash(ctx.row.file), show: ctx.row.kind === "file" && !ctx.row.id.startsWith("g:") },
            { label: "Delete folder", icon: <Trash2 size={14} />, danger: true, on: () => ctx.row.folder && setConfirmFolderDelete(ctx.row.folder), show: ctx.row.kind === "folder" }
          ].filter((i) => i.show).map((i) => (
            <button key={i.label} role="menuitem" onClick={() => { const fn = i.on; setCtx(null); fn(); }}
              className={`w-full flex items-center justify-between px-3.5 py-2 text-left hover:bg-tint ${"danger" in i && i.danger ? "text-danger" : "text-ink"}`}>
              <span>{i.label}</span>{"icon" in i && i.icon ? <span className="text-muted">{i.icon}</span> : null}
            </button>
          ))}
        </div>
      )}

      {/* Canvas menu (right-click on empty space) */}
      {canvasCtx && (
        <div role="menu" style={{ left: canvasCtx.x, top: canvasCtx.y }} onClick={(e) => e.stopPropagation()}
          className="pop-in fixed z-[70] w-[200px] py-1.5 rounded-lg bg-surface border border-line shadow-pop text-[13px]">
          <button role="menuitem" onClick={() => { setCanvasCtx(null); load(q); }}
            className="w-full flex items-center justify-between px-3.5 py-2 text-left hover:bg-tint">
            <span>Refresh</span><span className="text-muted"><RefreshCw size={14} /></span>
          </button>
          <button role="menuitem" onClick={() => { setCanvasCtx(null); fileRef.current?.click(); }}
            className="w-full flex items-center justify-between px-3.5 py-2 text-left hover:bg-tint">
            <span>Upload file</span><span className="text-muted"><Upload size={14} /></span>
          </button>
          {nav.kind === "root" && (
            <button role="menuitem" onClick={() => { setCanvasCtx(null); setShowNewFolder(true); }}
              className="w-full flex items-center justify-between px-3.5 py-2 text-left hover:bg-tint">
              <span>New folder</span><span className="text-muted"><FolderPlus size={14} /></span>
            </button>
          )}
          <button role="menuitem" disabled={!clip} title={clip ? `Paste "${clip.name}" here` : "Copy a file first"}
            onClick={() => { setCanvasCtx(null); pasteClip(); }}
            className="w-full flex items-center justify-between px-3.5 py-2 text-left hover:bg-tint disabled:opacity-40">
            <span>Paste{clip ? ` "${clip.name.length > 18 ? clip.name.slice(0, 17) + "…" : clip.name}"` : ""}</span>
            <span className="text-muted"><ClipboardPaste size={14} /></span>
          </button>
        </div>
      )}

      {tagEditor && <TagEditor tag={tagEditor.tag} api={tg} onClose={() => setTagEditor(null)} />}
      {tagPicker && <TagPicker target={tagPicker} api={tg} onClose={() => setTagPicker(null)} />}
      <ConfirmDialog open={!!confirmTagDel} title={`Delete tag “${confirmTagDel?.name}”?`}
        body="It is removed from every file and folder. The files themselves are not touched."
        confirmLabel="Delete tag" onClose={() => setConfirmTagDel(null)}
        onConfirm={async () => { const t = confirmTagDel; setConfirmTagDel(null); if (t && (await tg.remove(t.id))) setTagSel((x) => x.filter((i) => i !== t.id)); }} />

      {viewFile && <FileViewer file={viewFile} onClose={() => setViewFile(null)} onEdit={(f) => { setViewFile(null); setEditFile(f); }} />}
      {editFile && <FileEditor file={editFile} onClose={() => setEditFile(null)} onSaved={() => load(q)} />}

      <Modal open={showNewFolder} title="New folder" onClose={() => setShowNewFolder(false)} labelId="nf-title" width={400}>
        <form onSubmit={createFolder} className="flex flex-col gap-4">
          <div>
            <label htmlFor="nf-name" className="block text-[13px] text-muted">Folder name</label>
            <input id="nf-name" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120}
              className="w-full min-h-[44px] mt-1 bg-transparent border-0 border-b border-[#8f8f9a] focus:border-b-2 focus:border-brand focus:outline-none rounded-none px-0 text-[16px]" />
            <p className="text-[12px] text-muted mt-2">Created inside “{title}”.</p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowNewFolder(false)} className="min-h-[44px] px-4 rounded-md border border-line text-sm hover:bg-tint">Cancel</button>
            <button disabled={!newName.trim() || folderBusy} className="min-h-[44px] px-4 rounded-md bg-brand text-white text-sm font-medium disabled:opacity-50">{folderBusy ? "Creating…" : "Create"}</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={!!confirmPurge} title={`Delete “${confirmPurge?.name}” permanently?`}
        body="This erases the file from Eiden Drive and from Google Drive. It cannot be recovered afterwards — the Recovery Bin is the last safety net."
        confirmLabel={purging ? "Deleting…" : "Delete forever"} onClose={() => !purging && setConfirmPurge(null)} onConfirm={purge} />

      <ConfirmDialog open={!!confirmTrash} title="Move to Recovery Bin?"
        body={`"${confirmTrash?.name}" stays recoverable for 90 days. Members can never delete permanently.`}
        confirmLabel="Move to Bin" onClose={() => setConfirmTrash(null)} onConfirm={() => confirmTrash && trash(confirmTrash)} />
      <ConfirmDialog open={confirmBulk} title={`Trash ${selRows.length} files?`}
        body="They stay recoverable in the Recovery Bin for 90 days."
        confirmLabel="Move all to Bin" onClose={() => setConfirmBulk(false)} onConfirm={bulkTrash} />

      <Modal open={!!renameTarget} title={renameTarget?.kind === "folder" ? "Rename folder" : "Rename file"} onClose={() => setRenameTarget(null)} labelId="rn-title" width={400}>
        <form onSubmit={doRename} className="flex flex-col gap-4">
          <div>
            <label htmlFor="rn-name" className="block text-[13px] text-muted">New name</label>
            <input id="rn-name" autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={255}
              className="w-full min-h-[44px] mt-1 bg-transparent border-0 border-b border-[#8f8f9a] focus:border-b-2 focus:border-brand focus:outline-none rounded-none px-0 text-[16px]" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setRenameTarget(null)} className="min-h-[44px] px-4 rounded-md border border-line text-sm hover:bg-tint">Cancel</button>
            <button disabled={!renameValue.trim() || renameBusy} className="min-h-[44px] px-4 rounded-md bg-brand text-white text-sm font-medium disabled:opacity-50">{renameBusy ? "Renaming…" : "Rename"}</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={!!confirmFolderDelete} title="Delete folder?"
        body={`"${confirmFolderDelete?.name}" is deleted only if it is empty. Files must be trashed individually first — managers only.`}
        confirmLabel="Delete" onClose={() => setConfirmFolderDelete(null)} onConfirm={deleteFolder} />
    </section>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="h-full min-h-[260px] grid place-items-center p-8 text-center">
      <div className="flex flex-col items-center">
        <FolderIcon size={64} className="opacity-30" />
        <p className="mt-3 text-[15px] font-medium">{title}</p>
        <p className="mt-1 text-[13px] text-muted max-w-xs">{body}</p>
        {action && <button onClick={action.onClick} className="mt-4 min-h-[44px] px-4 rounded-md bg-brand text-white text-sm font-medium flex items-center gap-2"><Upload size={15} /> {action.label}</button>}
      </div>
    </div>
  );
}
