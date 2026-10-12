"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Menu as MenuIcon, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, LayoutList, LayoutGrid, Rows3, CircleEllipsis,
  Clock, FileText, Trash2, House, Info, Download, Link2, Search, Upload, FolderPlus, RefreshCw, X, Undo2, ExternalLink, Pencil, CloudDownload,
  Eye, Copy, Scissors, ClipboardPaste, HardDrive, Plus, Check, MoreHorizontal, Tag as TagIcon
} from "lucide-react";
import { toast } from "../ui/Toast";
import ConfirmDialog from "../ui/ConfirmDialog";
import Modal from "../ui/Modal";
import Menu from "../ui/Menu";
import { Ring, Dots, SparkleLoader, UploadPanel, type UploadItem, type UploadStatus } from "../ui/Loaders";
import { uploadResumable, cancelResumableSession, UploadCancelled } from "@/lib/upload-resumable-client";
import { RESUMABLE_MAX } from "@/lib/resumable";
import FileThumb from "./FileThumb";
import FileViewer, { type ViewFile } from "./FileViewer";
import FileEditor from "./FileEditor";
import { editable } from "./filetext";
import { FileGlyph, FileIcon, FolderIcon, kindOf } from "../ui/Glyphs";
import Pagination, { usePagination } from "../ui/Pagination";
import { useTags } from "../tags/useTags";
import { TagChip, TagDot, TagDots, TagEditor, TagPicker } from "../tags/TagUI";
import type { Tag, TagKind } from "../tags/useTags";
import { badge, classify, displayKind, fmtDateTime, formatBytes, isGoogleForestRoot } from "@/lib/files";

export interface Folder { id: string; name: string; parent: string | null; dept: string | null; created_at?: string | null; created_by_name?: string | null }
export interface FileRow {
  id: string; name: string; mime?: string; size?: number; backends: string[];
  owner?: string; updated?: string; updated_at?: string; folder?: string | null;
  hash?: string; storage_path?: string | null; accountLabel?: string; google_file_id?: string | null;
  google_parent_id?: string | null; drive_account_id?: string | null;
  created_at?: string | null; owner_name?: string | null;
}
interface BinRow { file_id: string; deleted_at: string; purge_at: string; file_index: { id: string; name: string; mime: string; size: number } | { id: string; name: string; mime: string; size: number }[] }

type View = "list" | "grid";
type SortKey = "name" | "updated" | "size" | "kind";
type Nav = { kind: "root" | "recent" | "docs" | "bin"; path: string[] };

interface Row {
  key: string; kind: "folder" | "file"; id: string; name: string; depth: number;
  dept: string | null; file?: FileRow; folder?: Folder; expandable?: boolean;
  // Google Drive folder (indexed file row with folder mime): renders as a
  // folder, expands inline over google ancestry. Holds the Drive folder id.
  googleFolder?: string | null;
  // Drive-tree folder backed by an index row: enables rename/delete through
  // the normal file flows (trash/rename mirror to Drive). Unindexed tree
  // folders (no row yet — sync first) stay Drive-only.
  indexId?: string | null;
}

const TAG_COLORS = ["#e5322d", "#2331e0", "#22c32e", "#f59e0b", "#ec4899", "#0ea5a4", "#8b5cf6"];
const DOC_KINDS = ["PDF", "DOCX", "XLSX", "PPTX", "HTML"];
const RECENT_LIMIT = 50;

async function sha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fmtDate(d?: string | null): string {
  return fmtDateTime(d);
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
  // Pre-scope leftovers (managers only): orphan rows visible to you alone.
  // Members never see a notice — hidden rows stay silently filtered.
  const [orphanCount, setOrphanCount] = useState(0);
  const [q, setQ] = useState("");
  const [hist, setHist] = useState<Nav[]>([{ kind: "root", path: [] }]);
  const [hi, setHi] = useState(0);
  const [view, setView] = useState<View>("list");
  // Covers are always on (no toggle): the flag stays as a plain constant so
  // cover-gated branches keep working without dead toggle code.
  const thumbs = true;
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
  const [clip, setClip] = useState<{ id: string; name: string; cut?: boolean } | null>(null);
  const [viewFile, setViewFile] = useState<ViewFile | null>(null);
  const [editFile, setEditFile] = useState<ViewFile | null>(null);
  const [accounts, setAccounts] = useState<{ id: string; label: string; email: string | null; free: number | null; usage?: number | null; limit?: number | null; status: string }[]>([]);
  const [driveSel, setDriveSel] = useState(""); // "" = Auto (roomiest drive)
  // Office-USB mirror toggle (persisted): uploads also queue an async agent job.
  const [usbTarget, setUsbTarget] = useState(false);
  // Google mirror toggle (persisted): off = Supabase-only uploads.
  const [mirrorOff, setMirrorOff] = useState(false);
  // Supabase intake toggle (persisted): off = bytes go straight to Google
  // Drive, Storage is never touched. USB copies need Supabase, so they switch
  // off too while this is off.
  const [supaOff, setSupaOff] = useState(false);
  useEffect(() => {
    try {
      const usb = localStorage.getItem("eiden-usb") === "1";
      if (localStorage.getItem("eiden-mirror") === "0") setMirrorOff(true);
      const supa = localStorage.getItem("eiden-supabase") === "0";
      if (supa) {
        setSupaOff(true);
        // Persisted conflict (USB on + Supabase off) used to silently drop the
        // USB copy: resolve it at load — USB off, Supabase stays off.
        if (usb) { try { localStorage.setItem("eiden-usb", "0"); } catch { /* ignore */ } }
      } else if (usb) {
        setUsbTarget(true);
      }
    } catch { /* ignore */ }
  }, []);
  function toggleUsb() {
    if (supaOff) {
      toast({ text: "USB copies pull from Supabase — turn Supabase on first.", tone: "err" });
      return;
    }
    setUsbTarget((v) => {
      try { localStorage.setItem("eiden-usb", v ? "0" : "1"); } catch { /* ignore */ }
      if (!v) toast({ text: "Uploads will also queue a copy to the office USB (agent picks it up when online).", tone: "ok" });
      return !v;
    });
  }
  function toggleMirror() {
    setMirrorOff((v) => {
      try { localStorage.setItem("eiden-mirror", v ? "1" : "0"); } catch { /* ignore */ }
      if (!v) toast({ text: "Google mirror off — uploads stay in Supabase only.", tone: "ok" });
      return !v;
    });
  }
  function toggleSupa() {
    setSupaOff((v) => {
      try { localStorage.setItem("eiden-supabase", v ? "1" : "0"); } catch { /* ignore */ }
      if (v) {
        // Turning Supabase back on changes nothing else.
      } else {
        // USB copies pull their bytes from Supabase — no Storage, no USB.
        setUsbTarget(false);
        try { localStorage.setItem("eiden-usb", "0"); } catch { /* ignore */ }
        toast({ text: "Supabase off — uploads go straight to Google Drive. USB copies need Supabase, so they're off too.", tone: "ok" });
      }
      return !v;
    });
  }
  function destSummary(): string {
    // Inside a drive view the drive itself is always a destination.
    if (inDriveView && driveView && supaOff && mirrorOff) {
      const a = accounts.find((x) => x.id === driveView.accountId);
      return `Upload → Drive: ${a ? a.label : "Drive"}`;
    }
    const parts = supaOff ? [] : ["Supabase"];
    if (!mirrorOff) {
      const a = driveSel ? accounts.find((x) => x.id === driveSel) : [...accounts].filter((x) => x.status === "active").sort((x, y) => (y.free ?? -1) - (x.free ?? -1))[0];
      parts.push(`Drive: ${a ? a.label : "Auto"}`);
    }
    if (usbTarget) parts.push("USB");
    return parts.length ? `Upload → ${parts.join(" + ")}` : "Upload — no destination (turn one on)";
  }
  const [driveView, setDriveView] = useState<{ accountId: string; folderId: string | null; path: { id: string; name: string }[] } | null>(null);
  const [tree, setTree] = useState<{ id: string; name: string; mime: string; size: number; googleId: string; parent: string | null }[] | null>(null);
  const [treeRoot, setTreeRoot] = useState<string | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
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
  const loadSeq = useRef(0);
  // Chunk size follows the "Rows per page" picker (pg.size); the auto-loader
  // below pulls one chunk at a time until the server says there is no more.
  const sizeRef = useRef(50);
  // Latest files for the append path: a silent refresh may replace the array
  // while a page is in flight — dedupe against the truth at resolve time, not
  // the stale closure, so overlapping pages can never double a file.
  const filesRef = useRef<FileRow[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  // Drive-style upload queue: every picked file becomes a panel row with its
  // own state (hashing → uploading w/ % → indexing → done/error), cancellable
  // mid-flight. Sequential — one active transfer, so one abort controller.
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [uploadPanelMin, setUploadPanelMin] = useState(false);
  const upSeq = useRef(0);
  const upAbort = useRef<AbortController | null>(null);
  // Live resumable session URI for the in-flight Drive upload (Supabase-off
  // path): Cancel deletes the Google session too, so an abandoned upload
  // leaves no resumable state behind.
  const upSessionUri = useRef<string | null>(null);
  const upCancelAll = useRef(false);
  const uploadActive = uploadItems.some((i) => i.status === "hashing" || i.status === "uploading" || i.status === "indexing");
  function setItem(key: number, patch: Partial<UploadItem>) {
    setUploadItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }
  function cancelUploads() {
    upCancelAll.current = true;
    upAbort.current?.abort();
    const uri = upSessionUri.current;
    upSessionUri.current = null;
    if (uri) void cancelResumableSession(uri);
  }
  // Signed-URL PUT with real byte progress (fetch can't report upload
  // progress). Aborts via the shared controller when the panel cancels.
  function putWithProgress(url: string, file: File, mime: string, key: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const ctl = new AbortController();
      upAbort.current = ctl;
      ctl.signal.addEventListener("abort", () => xhr.abort());
      xhr.timeout = 600_000; // 10 min ≈ 1.3 Mbps floor on 100 MB, fails loudly
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setItem(key, { pct: (e.loaded / e.total) * 100 });
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("byte upload failed")));
      xhr.onerror = () => reject(new Error("byte upload failed"));
      xhr.onabort = () => reject(new Error("cancelled"));
      xhr.ontimeout = () => reject(new Error("byte upload timed out"));
      xhr.open("PUT", url);
      xhr.setRequestHeader("content-type", mime);
      xhr.send(file);
    });
  }
  // Load failure worth showing (with Retry) — silent background refreshes only toast.
  const [loadError, setLoadError] = useState<string | null>(null);
  // Clipboard survives reloads; silent 60s auto-refresh (no skeleton flash).
  const qRef = useRef(q);
  qRef.current = q;
  filesRef.current = files;
  const lastGoogleError = useRef<string | null>(null);

  const nav = hist[hi];
  const curFolder = nav.kind === "root" ? nav.path[nav.path.length - 1] ?? null : null;
  // Inside a Google drive (tree mode, no search): creations belong to THAT
  // drive — a real Drive folder/file under the open Google folder — never to
  // the Workspace behind it.
  const inDriveView = !!driveView && nav.kind === "root" && !q.trim();
  const driveDestLabel = !driveView ? ""
    : `Drive “${accounts.find((a) => a.id === driveView.accountId)?.label ?? "Drive"}”${driveView.path.length ? ` › ${driveView.path.map((p) => p.name).join(" › ")}` : ""}`;

  const load = useCallback(async (query: string, from = 0, append = false, silent = false) => {
    if (append) setLoadingMore(true);
    else if (!silent) { setLoading(true); setLoadError(null); }
    // Sequence guard: search debounce + silent refresh + manual refresh can
    // overlap — a stale resolve must never clobber fresher state.
    const seq = ++loadSeq.current;
    // Every leg has a timeout: a stalled server must fail loudly with Retry,
    // never spin the skeletons forever (the "root stopped responding" bug).
    const c = new AbortController();
    const t = setTimeout(() => c.abort(new Error("request timed out after 30s")), 30_000);
    const limit = sizeRef.current;
    const get = (url: string) => fetch(url, { signal: c.signal }).then(async (r) => {
      if (r.status === 401) throw new Error("signed out — sign in again and retry");
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `server error ${r.status}`);
      }
      return r.json();
    });
    try {
      const [fr, dr, br] = await Promise.all([
        append ? null : get("/api/folders"),
        get(`/api/drive?q=${encodeURIComponent(query)}&limit=${limit}&offset=${from}${append ? "&append=1" : ""}`),
        append ? null : get("/api/drive/bin")
      ]);
      if (seq !== loadSeq.current) return; // superseded — drop, don't paint
      if (fr) setFolders(fr.results ?? []);
      if (append) {
        const incoming = (dr.results ?? []) as FileRow[];
        const seen = new Set(filesRef.current.map((f) => f.id));
        const fresh = incoming.filter((f) => !seen.has(f.id));
        if (fresh.length) setFiles((prev) => [...prev, ...fresh.filter((f) => !prev.some((p) => p.id === f.id))]);
        // A page that adds nothing new means the end (order shifted under us
        // or the server is repeating itself) — stop instead of looping forever.
        setHasMore(fresh.length > 0 && (typeof dr.hasMore === "boolean" ? dr.hasMore : incoming.length >= limit));
      } else {
        setFiles((dr.results ?? []) as FileRow[]);
        setHasMore(typeof dr.hasMore === "boolean" ? dr.hasMore : ((dr.results ?? []).length >= limit));
      }
      if (!append) setOrphanCount(typeof dr.orphanCount === "number" ? dr.orphanCount : 0);
      if (br) { setBin(br.results ?? []); setCanPurge(!!br.canPurge); }
      if (dr.google_error && dr.google_error !== lastGoogleError.current) {
        lastGoogleError.current = dr.google_error;
        toast({ text: dr.google_error, tone: "err" });
      }
    } catch (e) {
      const msg = e instanceof Error
        ? /abort|timed out/i.test(e.message) ? "The server took too long (>30s) — it may be waking up or stuck. Retry, and check /api/health if it repeats."
        : e.message
        : "Couldn't reach the server.";
      if (silent) toast({ text: `Background refresh failed: ${msg}`, tone: "err" });
      else setLoadError(msg);
    } finally {
      clearTimeout(t);
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  function loadMore() {
    // Guarded twice (here + the sentinel effect): never stack concurrent pages.
    if (loadingMore || loading) return;
    if (!hasMore) return;
    // Live Google rows (g:*) aren't in the index — offset counts indexed rows only.
    const indexed = files.filter((f) => !f.id.startsWith("g:")).length;
    load(q, indexed, true);
  }
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  // Infinite scroll: when the end sentinel scrolls into view, pull the next
  // chunk automatically (chunk = the "Rows per page" picker). No button.
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = moreRef.current;
    if (!el || !hasMore || loading) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) loadMoreRef.current();
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, loadingMore, nav.kind, q]);

  useEffect(() => {
    let dead = false;
    fetch("/api/drive/accounts", { signal: AbortSignal.timeout(15_000) }).then((r) => r.json().catch(() => ({}))).then((d) => {
      if (!dead) setAccounts(d.results ?? []);
    }).catch(() => { /* picker stays hidden */ });
    return () => { dead = true; };
  }, []);

  useEffect(() => {
    try { const v = localStorage.getItem("eiden-upload-drive"); if (v) setDriveSel(v); } catch { /* ignore */ }
  }, []);
  // A remembered drive that no longer exists — or was disabled since — falls
  // back to Auto. Without this a stale pin would aim every upload at a drive
  // the server now refuses (the backend still re-checks fresh: this is just
  // the fast, no-wasted-hashing path).
  useEffect(() => {
    if (driveSel && accounts.length && !accounts.some((a) => a.id === driveSel && a.status === "active")) {
      setDriveSel("");
      try { localStorage.setItem("eiden-upload-drive", ""); } catch { /* ignore */ }
    }
  }, [accounts, driveSel]);
  function chooseUploadDrive(id: string) {
    // The picker only lists active drives, but refuse a stale/inactive pick
    // anyway — never persist a destination the server would reject.
    if (id && !accounts.some((a) => a.id === id && a.status === "active")) {
      toast({ text: "That drive isn't available — staying on Auto.", tone: "err" });
      return;
    }
    setDriveSel(id);
    try { localStorage.setItem("eiden-upload-drive", id); } catch { /* ignore */ }
    // Picking a drive implies the mirror is wanted.
    if (id && mirrorOff) {
      setMirrorOff(false);
      try { localStorage.setItem("eiden-mirror", "1"); } catch { /* ignore */ }
    }
  }

  // Every mutation reloads the workspace list AND — when a drive is open —
  // its tree. Without the second half, trashed/renamed/moved drive items
  // linger visibly until the next manual Sync ("deleted but still there").
  function refreshAll() {
    load(q);
    if (driveView) void loadTree(driveView.accountId);
  }

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    try {
      const raw = localStorage.getItem("eiden-clip");
      if (raw) setClip(JSON.parse(raw));
    } catch { /* ignore */ }
    // Auto-refresh every 60s, silently: same call as manual Refresh but without
    // the skeleton flash (silent=true skips setLoading). Skipped once the user
    // has auto-loaded extra pages: a base reload would collapse them back to
    // chunk 1 with no notice — the next manual Refresh still catches up.
    const t = setInterval(() => {
      if (filesRef.current.length > sizeRef.current) return;
      loadRef.current(qRef.current, 0, false, true);
    }, 60000);
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
  // Tag colors hash by NAME, not by department-list position: adding or
  // renaming a department used to reshuffle every tag's color.
  const tagColor = useCallback((d: string | null) => {
    if (!d) return null;
    let h = 0;
    for (let i = 0; i < d.length; i++) h = (h * 31 + d.charCodeAt(i)) >>> 0;
    return TAG_COLORS[h % TAG_COLORS.length];
  }, []);
  const pathTo = useCallback((folderId: string): string[] => {
    const out: string[] = []; let id: string | null = folderId; let guard = 0;
    while (id && guard++ < 20) { out.unshift(id); id = folderById.get(id)?.parent ?? null; }
    return out;
  }, [folderById]);

  // Google folder path inside the open drive (ancestors from the tree index).
  // Used for the Location column while browsing a drive: "where" beats "what".
  const gById = useMemo(() => new Map((tree ?? []).map((t) => [t.googleId, t])), [tree]);
  function drivePath(gid: string | null | undefined, selfName?: string | null): string | null {
    if (!gid || !tree) return null;
    const node = gById.get(gid);
    let cur: string | null = node ? node.parent : null;
    const parts: string[] = selfName ? [selfName] : [];
    let guard = 0;
    while (cur && guard++ < 10) {
      const n = gById.get(cur);
      if (!n) break;
      parts.unshift(n.name);
      cur = n.parent;
    }
    return parts.length ? parts.join(" › ") : null;
  }
  function locText(r: Row): string {
    // Inside a drive view the Location column names the PLACE (folder path),
    // falling back to the backend badge when the path is unresolvable.
    if (driveView) {
      const g = r.kind === "folder"
        ? (r.googleFolder ?? (r.id.startsWith("gdrive:") ? r.id.slice("gdrive:".length) : null))
        : r.file?.google_file_id ?? null;
      if (g) {
        const p = drivePath(g, r.kind === "folder" ? r.name : undefined);
        if (p) return p;
      }
      if (r.kind === "folder") return "—";
    }
    // Workspace files: same-name files in different folders were
    // indistinguishable (backend badge only) — show the folder path first.
    if (r.file?.folder) {
      const ids = pathTo(r.file.folder);
      const names = ids.map((id) => folderById.get(id)?.name).filter(Boolean) as string[];
      if (names.length) return names.join(" › ");
    }
    return r.file ? badge(r.file.backends, r.file.accountLabel) || "—" : "—";
  }

  // Details-panel facts. Folders get folder facts (where, what's inside, who
  // made it); files get file facts. "--" only when the data truly doesn't exist.
  function detailRows(r: Row): [string, string][] {
    const gid = r.kind === "folder"
      ? (r.googleFolder ?? (r.id.startsWith("gdrive:") ? r.id.slice("gdrive:".length) : null))
      : null;
    if (r.kind === "folder") {
      let subFolders = 0, subFiles = 0, latest = "";
      const bump = (d?: string | null) => { if (d && d > latest) latest = d; };
      if (r.folder) {
        subFolders = folders.filter((f) => f.parent === r.folder!.id).length;
        for (const f of files) if (f.folder === r.folder.id) { subFiles++; bump(f.updated_at ?? f.updated); }
      } else if (gid) {
        const kids = tree ? tree.filter((t) => t.parent === gid) : [];
        if (kids.length) {
          for (const k of kids) if (k.mime === "application/vnd.google-apps.folder") subFolders++; else subFiles++;
        } else {
          for (const f of files) if (f.google_parent_id === gid) {
            if (f.mime === "application/vnd.google-apps.folder") subFolders++; else { subFiles++; bump(f.updated_at ?? f.updated); }
          }
        }
      }
      const where = r.folder
        ? ["Workspace", ...pathTo(r.folder.id).slice(0, -1).map((id) => folderById.get(id)?.name ?? "Folder")].join(" › ")
        : gid ? (drivePath(gid) ?? (r.file?.accountLabel ? `Google · ${r.file.accountLabel}` : "Google Drive")) : "--";
      const indexRow = r.file ?? (r.indexId ? files.find((f) => f.id === r.indexId) : undefined);
      const createdBy = r.folder ? r.folder.created_by_name : indexRow?.owner_name;
      const createdAt = r.folder ? r.folder.created_at : indexRow?.created_at;
      const count = `${subFolders} folder${subFolders === 1 ? "" : "s"} · ${subFiles} file${subFiles === 1 ? "" : "s"}`;
      return [
        ["Created by", createdBy ?? "--"],
        ["Created", fmtDate(createdAt)],
        ["Modified", fmtDate(latest || indexRow?.updated_at || indexRow?.updated)],
        ["Location", where],
        ["Contains", count],
        ["Size", folderSize(r)],
        ...(indexRow?.accountLabel ? [["Drive", indexRow.accountLabel] as [string, string]] : [])
      ];
    }
    const f = r.file;
    return [
      ["Created by", f?.owner_name ?? "--"],
      ["Created", fmtDate(f?.created_at)],
      ["Modified", f ? fmtDate(f.updated_at ?? f.updated) : "--"],
      ["Location", locText(r)],
      ...(f?.accountLabel ? [["Drive", f.accountLabel] as [string, string]] : []),
      ["SHA-256", f?.hash ? `${f.hash.slice(0, 12)}…` : "--"]
    ];
  }

  // Contained-bytes totals per folder: local ancestry via the folders table,
  // Google ancestry via recorded Drive parents (+ the open tree as fallback).
  // Folders show their total instead of "—".
  const folderBytes = useMemo(() => {
    const local = new Map<string, number>();
    const addLocal = (fid: string, n: number, guard = 0): void => {
      if (guard > 25) return;
      local.set(fid, (local.get(fid) ?? 0) + n);
      const p = folderById.get(fid)?.parent;
      if (p) addLocal(p, n, guard + 1);
    };
    const gmap = new Map<string, { parent: string | null; size: number }>();
    for (const f of files) {
      if (f.google_file_id) gmap.set(f.google_file_id, { parent: f.google_parent_id ?? null, size: f.size ?? 0 });
    }
    for (const t of tree ?? []) {
      if (!gmap.has(t.googleId)) gmap.set(t.googleId, { parent: t.parent, size: t.size ?? 0 });
    }
    const gtotal = new Map<string, number>();
    for (const [gid, node] of gmap) {
      if (!node.size) continue;
      let cur: string | null = node.parent;
      let guard = 0;
      while (cur && guard++ < 25) {
        gtotal.set(cur, (gtotal.get(cur) ?? 0) + node.size);
        cur = gmap.get(cur)?.parent ?? null;
      }
    }
    for (const f of files) {
      if (typeof f.size === "number" && f.size > 0 && f.folder) addLocal(f.folder, f.size);
    }
    return { local, gtotal };
  }, [files, folders, folderById, tree]);
  function folderSize(r: Row): string {
    if (r.kind !== "folder") return "—";
    let total = 0;
    let known = false;
    if (r.folder) {
      // Known when the folder id is in the loaded set — then 0 really means
      // empty ("Empty"), not "couldn't tell" ("—").
      known = folderById.has(r.folder.id);
      total = folderBytes.local.get(r.folder.id) ?? 0;
    } else if (r.googleFolder) {
      known = true;
      total = folderBytes.gtotal.get(r.googleFolder) ?? 0;
    } else if (r.id.startsWith("gdrive:")) {
      known = true;
      total = folderBytes.gtotal.get(r.id.slice("gdrive:".length)) ?? 0;
    }
    if (!known) return "—";
    return total > 0 ? formatBytes(total) : "Empty";
  }

  // ── rows ──
  const rows: Row[] = useMemo(() => {
    const dir = sort.dir;
    const fval = (f: FileRow): string | number => {
      if (sort.key === "size") return f.size ?? 0;
      if (sort.key === "updated") return f.updated_at ?? f.updated ?? "";
      // Sort by what's DISPLAYED: classify() disagrees with the Kind column
      // (csv sorts as XLSX but shows "CSV table"), so sort the label itself.
      if (sort.key === "kind") return displayKind(f.name, f.mime);
      return f.name.toLowerCase();
    };
    const sortFiles = (list: FileRow[]) => [...list].sort((a, b) => { const va = fval(a), vb = fval(b); return (va < vb ? -1 : va > vb ? 1 : 0) * dir; });
    const sortFolders = (list: Folder[]) => [...list].sort((a, b) => a.name.localeCompare(b.name) * (sort.key === "name" ? dir : 1));
    const fileRowOf = (f: FileRow, depth: number): Row => ({ key: f.id, kind: "file", id: f.id, name: f.name, depth, dept: deptOf(f.folder), file: f });
    const folderRowOf = (f: Folder, depth: number): Row => ({ key: `folder:${f.id}`, kind: "folder", id: f.id, name: f.name, depth, dept: deptOf(f.id), folder: f,
      expandable: folders.some((x) => x.parent === f.id) || files.some((x) => x.folder === f.id) });
    // Google Drive folders index as FILE rows (folder mime + google pin) but
    // must render as FOLDERS — otherwise a new drive folder shows up as a file.
    const GFOLDER = "application/vnd.google-apps.folder";
    const isGFolder = (f: FileRow) => f.mime === GFOLDER && !!f.google_file_id;
    const gFolderRowOf = (f: FileRow, depth: number): Row => ({ key: f.id, kind: "folder", id: f.id, name: f.name, depth, dept: deptOf(f.folder), file: f,
      googleFolder: f.google_file_id ?? null,
      expandable: files.some((x) => x.google_parent_id === f.google_file_id) });

    if (nav.kind === "bin") return [];
    if (nav.kind === "recent") return sortFiles(files.filter((f) => !isGFolder(f))).sort((a, b) => String(b.updated_at ?? b.updated ?? "").localeCompare(String(a.updated_at ?? a.updated ?? ""))).slice(0, RECENT_LIMIT).map((f) => fileRowOf(f, 0));
    if (nav.kind === "docs") return sortFiles(files.filter((f) => !isGFolder(f) && DOC_KINDS.includes(classify(f.name, f.mime)))).map((f) => fileRowOf(f, 0));
    // Drive tree view: one account's Google folders/files from the index.
    // Top level = children of the account's configured root ONLY. A folder
    // scope must never leak the rest of My Drive (the old parent-null fallback
    // did exactly that). Whole-My-Drive roots (rootId null) keep the heuristic.
    if (driveView && nav.kind === "root" && !q.trim()) {
      if (!tree) return [];
      const acctLabel = accounts.find((a) => a.id === driveView.accountId)?.label ?? "Drive";
      const idSet = new Set(tree.map((t) => t.googleId));
      // Server already scoped this slice to the account subtree; placeless
      // rows (no recorded parent) ride at the top rather than vanishing.
      const top = (t: { parent: string | null }) => treeRoot ? (t.parent === treeRoot || !t.parent) : (!t.parent || !idSet.has(t.parent));
      const kids = tree.filter((t) => driveView.folderId ? t.parent === driveView.folderId : top(t));
      const gFolders = kids.filter((k) => k.mime === "application/vnd.google-apps.folder");
      const gFiles = kids.filter((k) => k.mime !== "application/vnd.google-apps.folder");
      const toFile = (t: { id: string; name: string; mime: string; size: number; googleId: string; parent: string | null }): FileRow =>
        ({ id: t.id ?? `g:${driveView.accountId}:${t.googleId}`, name: t.name, mime: t.mime, size: t.size, backends: ["google"], accountLabel: acctLabel, google_file_id: t.googleId, google_parent_id: t.parent, drive_account_id: driveView.accountId });
      return [
        ...gFolders.map((g): Row => ({ key: `gdrive:${g.googleId}`, kind: "folder", id: `gdrive:${g.googleId}`, name: g.name, depth: 0, dept: null, indexId: g.id ?? null })),
        ...sortFiles(gFiles.map(toFile)).map((f) => fileRowOf(f, 0))
      ];
    }
    if (tagSel.length) {
      const n = q.trim().toLowerCase();
      const has = (kind: TagKind, id: string) => tagSel.every((t) => tg.idsOf(kind, id).includes(t));
      return [...sortFolders(folders.filter((f) => has("folder", f.id) && (!n || f.name.toLowerCase().includes(n)))).map((f) => folderRowOf(f, 0)),
        ...sortFiles(files.filter((f) => !f.id.startsWith("g:") && !isGFolder(f) && has("file", f.id) && (!n || f.name.toLowerCase().includes(n)))).map((f) => fileRowOf(f, 0)),
        ...sortFiles(files.filter((f) => !f.id.startsWith("g:") && isGFolder(f) && has("file", f.id) && (!n || f.name.toLowerCase().includes(n)))).map((f) => gFolderRowOf(f, 0))];
    }
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      // Text search never silently drops the department filter: when a dept
      // is active the query intersects it (previously the dept was ignored
      // the moment you typed, showing other departments' files).
      const inDept = (d: string | null) => !tagFilter || d === tagFilter;
      return [...sortFolders(folders.filter((f) => f.name.toLowerCase().includes(n) && inDept(deptOf(f.id)))).map((f) => folderRowOf(f, 0)),
        ...sortFiles(files.filter((f) => !isGFolder(f) && f.name.toLowerCase().includes(n) && inDept(deptOf(f.folder)))).map((f) => fileRowOf(f, 0)),
        ...sortFiles(files.filter((f) => isGFolder(f) && f.name.toLowerCase().includes(n))).map((f) => gFolderRowOf(f, 0))];
    }
    if (tagFilter) {
      return [...sortFolders(folders.filter((f) => deptOf(f.id) === tagFilter)).map((f) => folderRowOf(f, 0)),
        ...sortFiles(files.filter((f) => deptOf(f.folder) === tagFilter)).map((f) => fileRowOf(f, 0))];
    }
    const out: Row[] = [];
    // Collapse state rules BOTH views identically: grid never flattens on
    // its own — entering grid collapses everything (switchView), so grid
    // shows the current level only, exactly like a collapsed list.
    const walk = (parent: string | null, depth: number) => {
      for (const f of sortFolders(folders.filter((x) => (x.parent ?? null) === parent))) {
        out.push(folderRowOf(f, depth));
        if (expanded.has(f.id)) walk(f.id, depth + 1);
      }
      for (const f of sortFiles(files.filter((x) => (x.folder ?? null) === parent && !isGFolder(x)))) out.push(fileRowOf(f, depth));
    };
    walk(curFolder, 0);
    // Google Drive folders live at the top level (no workspace parent):
    // render as folders with inline expansion over google ancestry.
    // Only true roots render here: a google folder whose parent is itself
    // indexed renders ONLY under that parent (via gWalk when expanded) —
    // otherwise every subfolder duplicates at the top level. Rows whose
    // parent isn't indexed (unsynced/out-of-scope) stay top-level so nothing
    // vanishes.
    const indexedGoogleIds = new Set(
      files.filter((x) => x.google_file_id).map((x) => x.google_file_id as string)
    );
    if (curFolder === null) {
      const gWalk = (gid: string, depth: number) => {
        for (const f of sortFiles(files.filter((x) => x.google_parent_id === gid && !isGFolder(x)))) out.push(fileRowOf(f, depth));
        for (const f of sortFiles(files.filter((x) => x.google_parent_id === gid && isGFolder(x)))) {
          out.push(gFolderRowOf(f, depth));
          if (expanded.has(f.id) && f.google_file_id) gWalk(f.google_file_id, depth + 1);
        }
      };
      for (const f of sortFiles(files.filter((x) => (x.folder ?? null) === null && isGFolder(x) && isGoogleForestRoot(x, indexedGoogleIds)))) {
        out.push(gFolderRowOf(f, 0));
        if (expanded.has(f.id) && f.google_file_id) gWalk(f.google_file_id, 1);
      }
    }
    return out;
  }, [nav.kind, files, folders, q, tagFilter, tagSel, tg.idsOf, sort, expanded, curFolder, deptOf, driveView, tree, treeRoot, accounts]);

  // Pagination: files/folders (list + grid) and the Recovery Bin page independently; any navigation/filter/sort resets to page 1.
  const pg = usePagination(rows, { defaultSize: 50, sizes: [25, 50, 100, 200], storageKey: "files",
    resetKey: `${nav.kind}|${nav.path.join("/")}|${q}|${tagSel.join(",")}|${tagFilter}|${driveView?.accountId}|${driveView?.folderId}|${sort.key}${sort.dir}` });
  const binPg = usePagination(bin, { defaultSize: 25, sizes: [10, 25, 50, 100], storageKey: "bin" });
  // Server chunk size tracks the picker: change "Rows per page" and the next
  // auto-load pulls exactly that many. (Assign during render — refs by design.)
  sizeRef.current = pg.size;

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
    clearSel(); setInfoOpen(false); setCtx(null); setTagFilter(null); setQ("");
    closePaneOnPhone();
  }
  function back() { if (hi > 0) { setHi(hi - 1); clearSel(); } }
  function forward() { if (hi < hist.length - 1) { setHi(hi + 1); clearSel(); } }

  function open(r: Row) {
    if (r.kind === "folder") {
      // Google-tree folders descend inside the drive view; local folders use history.
      if (r.id.startsWith("gdrive:")) {
        const gid = r.id.slice("gdrive:".length);
        const dv = driveView;
        if (dv) setDriveView({ ...dv, folderId: gid, path: [...dv.path, { id: gid, name: r.name }] });
        return;
      }
      // Indexed Google folders (created from a drive view) expand inline —
      // they have no workspace path to navigate to.
      if (r.googleFolder) { toggleExpand(r.id); return; }
      go({ kind: "root", path: pathTo(r.id) });
      return;
    }
    // Double-click / Enter / Open = in-app preview for every file kind.
    if (r.file) setViewFile(toViewFile(r.file));
  }
  function toggleExpand(id: string) {
    setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  // View switches never touch expansion: both views read the same `expanded`
  // state, so list → grid → list finds the tree exactly how you left it.
  function switchView(v: View) {
    if (v === view) return;
    setView(v);
  }
  function onRowKey(e: React.KeyboardEvent, r: Row) {
    if (e.key === "Enter") open(r);
    else if (e.key === " ") { e.preventDefault(); setSelKey(r.key); setMulti([]); }
    else if (e.key === "ArrowRight" && r.kind === "folder" && !expanded.has(r.id)) toggleExpand(r.id);
    else if (e.key === "ArrowLeft" && r.kind === "folder" && expanded.has(r.id)) toggleExpand(r.id);
    // Keyboard route to the right-click menu (Shift+F10 / Menu key): rows
    // were pointer-only, locking out keyboard and screen-reader users.
    else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setSelKey(r.key);
      setCtx({ x: Math.min(box.left + 40, window.innerWidth - 200), y: Math.min(box.bottom + 4, window.innerHeight - 260), row: r });
    }
  }

  // Click selection: plain = single, Ctrl/Cmd = toggle, Shift = range from anchor.
  // Touch screens have no double-click or hover: a plain tap opens, like Drive mobile.
  const touchRef = useRef(false);
  const notePointer = (e: React.PointerEvent) => { touchRef.current = e.pointerType === "touch"; };
  const isPhone = () => !window.matchMedia("(min-width: 768px)").matches;
  const closePaneOnPhone = () => { if (isPhone()) setPane(false); };

  function clickRow(e: React.MouseEvent, r: Row, idx: number) {
    e.stopPropagation();
    if (touchRef.current && !e.shiftKey && !e.ctrlKey && !e.metaKey && multi.length === 0) { setSelKey(r.key); open(r); return; }
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
    if (!selRows.length || bulkBusy) return;
    setBulkBusy(true);
    // Live Google rows (g:) are counted in the selection but can only be
    // trashed from the drive tree — say so instead of silently skipping.
    const skippedLive = [...selSet].filter((k) => k.startsWith("g:")).length;
    let ok = 0;
    for (const r of selRows) {
      const res = await fetch("/api/drive/trash", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id: r.id }) });
      if (res.ok) ok++;
    }
    clearSel();
    setBulkBusy(false);
    toast({ text: `${ok} file${ok === 1 ? "" : "s"} moved to Recovery Bin.${skippedLive ? ` ${skippedLive} live Google row${skippedLive === 1 ? "" : "s"} skipped — trash those from the drive tree.` : ""}${ok < selRows.length ? ` ${selRows.length - ok} failed.` : ""}`, tone: ok ? "ok" : "err" });
    refreshAll();
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
    toast({ text: `Downloading ${downs.length} file${downs.length === 1 ? "" : "s"}…${downs.length > 1 ? " if only the first arrives, allow pop-ups for this site and retry." : ""}`, tone: "ok" });
    if (downs.length < selRows.length) toast({ text: "Google-only files were skipped — sync them for a local copy.", tone: "err" });
  }

  // Keyboard shortcuts (ignored while typing, viewing, or editing). No dep
  // array on purpose: the handler reads fresh selection/page state every
  // render (re-subscribing a keydown listener is ~free; a stale closure that
  // trashes the wrong files is not).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (viewFile || editFile) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "c") {
        const f = selRows[0]?.file;
        // Single-item clipboard by design: with several selected, copy the
        // first and say so (previously it copied the first silently).
        if (f) {
          e.preventDefault(); copyFile(f);
          if (selRows.length > 1) toast({ text: `${selRows.length} selected — copied the first (“${f.name}”).`, tone: "info" });
        }
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
  const [trashBusy, setTrashBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [clipBusy, setClipBusy] = useState(false);
  const [usbBusy, setUsbBusy] = useState<string | null>(null);
  async function trash(f: FileRow) {
    if (trashBusy) return;
    setTrashBusy(true);
    const r = await fetch("/api/drive/trash", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id: f.id }) });
    setTrashBusy(false);
    if (r.ok) {
      toast({ text: `"${f.name}" moved to Recovery Bin (90 days).`, tone: "ok" });
      setFiles((p) => p.filter((x) => x.id !== f.id));
      setSelKey(null);
      refreshAll();
    } else {
      const d = await r.json().catch(() => ({} as { error?: string }));
      toast({ text: (d as { error?: string }).error ?? "Trash failed. Try again.", tone: "err" });
    }
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
      setSelKey(null); setConfirmPurge(null); refreshAll();
    } else { toast({ text: d.error ?? "Couldn't delete the file.", tone: "err" }); setConfirmPurge(null); }
  }

  // Orphan clear (manager card): confirmed, then deletes the pre-scope
  // leftovers and reloads so the counts — and the card itself — disappear.
  const [clearing, setClearing] = useState(false);
  const [confirmClearOrphans, setConfirmClearOrphans] = useState(false);
  async function clearOrphans() {
    if (clearing) return;
    setClearing(true);
    setConfirmClearOrphans(false);
    try {
      const r = await fetch("/api/drive/clear-orphans", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "clear failed");
      toast({ text: `Cleared ${d.deleted} leftover${d.deleted === 1 ? "" : "s"}${d.unpinned ? `, unpinned ${d.unpinned}` : ""}. Now run Sync from Google.`, tone: "ok" });
      load(q);
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "Clear failed.", tone: "err" });
    } finally {
      setClearing(false);
    }
  }

  const [restoreBusy, setRestoreBusy] = useState<string | null>(null);
  async function restore(id: string, name: string) {
    if (restoreBusy) return;
    setRestoreBusy(id);
    const r = await fetch("/api/drive/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id: id }) });
    setRestoreBusy(null);
    if (r.ok) { toast({ text: `"${name}" restored.`, tone: "ok" }); setSelKey(null); refreshAll(); }
    else {
      const d = await r.json().catch(() => ({} as { error?: string }));
      toast({ text: (d as { error?: string }).error ?? "Restore failed.", tone: "err" });
    }
  }

  async function createFolder(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || folderBusy) return;
    setFolderBusy(true);
    try {
      if (inDriveView && driveView) {
        // A real Google Drive folder inside the open drive location.
        const r = await fetch("/api/drive/google-folder", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountId: driveView.accountId, parentId: driveView.folderId, name }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error ?? "Couldn't create folder in Drive.");
        toast({ text: `Folder "${name}" created in ${driveDestLabel}.`, tone: "ok" });
        setNewName(""); setShowNewFolder(false);
        await loadTree(driveView.accountId);
        load(q);
        return;
      }
      const r = await fetch("/api/folders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, parent: curFolder }) });
      if (r.ok) { toast({ text: `Folder "${name}" created.`, tone: "ok" }); setNewName(""); setShowNewFolder(false); load(q); }
      else toast({ text: "Couldn't create folder.", tone: "err" });
    } catch (err) {
      toast({ text: err instanceof Error ? err.message : "Couldn't create folder.", tone: "err" });
    } finally {
      setFolderBusy(false);
    }
  }

  async function uploadPicked(list: FileList | null) {
    const files = list ? Array.from(list) : [];
    if (!files.length) return;
    // One batch at a time: the picker, drag-drop and canvas button all funnel
    // here — a second batch mid-flight used to race the queue.
    if (uploadActive) {
      toast({ text: "An upload is already running — wait for it to finish.", tone: "err" });
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    // Inside a drive view the drive itself is the destination, so the
    // toggles can't leave you destination-less — otherwise require one.
    if (supaOff && mirrorOff && !inDriveView) {
      toast({ text: "No upload destination — turn on Supabase or the Google mirror first.", tone: "err" });
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const dest = inDriveView && driveView
      ? (accounts.find((a) => a.id === driveView.accountId)?.label ?? "Drive")
      : supaOff ? "Drive" : "Supabase";
    // Fast availability pre-check (the backend re-validates fresh anyway):
    // fail the batch BEFORE hashing/transferring when the pinned drive is
    // gone or disabled — e.g. disabled after this page loaded its list.
    const pinnedDrive = inDriveView && driveView ? driveView.accountId : (!supaOff && !mirrorOff ? driveSel || null : null);
    if (pinnedDrive) {
      const tgt = accounts.find((a) => a.id === pinnedDrive);
      if (!tgt || tgt.status !== "active") {
        toast({ text: `The chosen drive${tgt?.label ? ` (“${tgt.label}”)` : ""} isn't available — pick another drive or use Auto.`, tone: "err" });
        if (fileRef.current) fileRef.current.value = "";
        return;
      }
    }
    const batch = files.map((f) => ({
      key: ++upSeq.current, name: f.name, size: f.size, mime: f.type || "application/octet-stream",
      status: "hashing" as UploadStatus, pct: null as number | null, dest,
    }));
    setUploadItems(batch);
    setUploadPanelMin(false);
    upCancelAll.current = false;
    let ok = 0;
    for (let bi = 0; bi < files.length; bi++) {
      const file = files[bi];
      const key = batch[bi].key;
      if (upCancelAll.current) { setItem(key, { status: "error", error: "cancelled" }); continue; }
      try {
        // Size gate BEFORE hashing: sha256 buffers the whole file — rejecting
        // a huge pick after a long hash is the OOM/timeout the cap exists to prevent.
        if (supaOff && file.size > RESUMABLE_MAX) throw new Error("over 2 GB — Drive uploads top out at 2 GB");
        if (!supaOff && file.size > 100 * 1024 * 1000) throw new Error("over 100 MB — the server refuses it (Storage cap)");
        // Supabase off: resumable direct-to-Google for EVERY size (one
        // consistent path — no Supabase bytes at any stage, small or large).
        // Hashing a multi-GB file would buffer it all in the tab, so the
        // hash is best-effort here (advisory only: versions accept "").
        if (supaOff) {
          let hash: string | null = null;
          try { hash = await sha256(file); } catch { hash = null; }
          if (upCancelAll.current) throw new Error("cancelled");
          // Initiate: the server authorizes (auth, active drive, dept folder,
          // scope, quota) and mints a Google session bound to this metadata.
          const initBody: Record<string, unknown> = {
            name: file.name, mime: file.type || "application/octet-stream", size: file.size,
          };
          if (hash) initBody.hash = hash;
          if (inDriveView && driveView) {
            initBody.drive_account = driveView.accountId;
            if (driveView.folderId) initBody.google_parent = driveView.folderId;
            initBody.folder = null;
          } else {
            if (curFolder) initBody.folder = curFolder;
            if (driveSel) initBody.drive_account = driveSel;
          }
          const init = await fetch("/api/drive/resumable/init", {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(initBody),
          });
          const sess = await init.json().catch(() => ({}));
          if (!init.ok || !sess.sessionUri) throw new Error(sess.error ?? "couldn't start the Google upload");
          if (upCancelAll.current) {
            void cancelResumableSession(sess.sessionUri as string);
            throw new Error("cancelled");
          }
          setItem(key, { status: "uploading", pct: 0 });
          const ctl = new AbortController();
          upAbort.current = ctl;
          upSessionUri.current = sess.sessionUri as string;
          let driveFileId: string;
          try {
            const resource = await uploadResumable(sess.sessionUri as string, file, {
              signal: ctl.signal,
              onProgress: (confirmed, total) => setItem(key, { pct: (confirmed / total) * 100 }),
            });
            driveFileId = resource.id;
          } finally {
            upSessionUri.current = null;
          }
          if (upCancelAll.current) throw new Error("cancelled");
          // Register: the server re-verifies the landed file against Google
          // (size/parents/scope, drive still active) before indexing it.
          setItem(key, { status: "indexing", pct: null });
          const done = await fetch("/api/drive/resumable/complete", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({
              driveFileId, accountId: sess.accountId as string,
              ...(initBody.folder ? { folder: initBody.folder } : {}),
              ...(hash ? { hash } : {}),
            }),
          });
          const dj = await done.json().catch(() => ({}));
          if (!done.ok) throw new Error(dj.error ?? "couldn't register the upload");
          setItem(key, { status: "done", pct: 100 });
          if (inDriveView && driveView) await loadTree(driveView.accountId);
          continue;
        }
        const hash = await sha256(file);
        if (upCancelAll.current) throw new Error("cancelled");
        // The init call carries the intended mirror target so the server can
        // refuse an unavailable drive BEFORE bytes move (register re-checks).
        // Local-only uploads (mirror off) pin nothing — validating the unused
        // picker drive would wrongly fail them.
        const initDrive = inDriveView && driveView ? driveView.accountId : (!mirrorOff ? (driveSel || undefined) : undefined);
        const init = await fetch("/api/drive/upload-url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: file.name, mime: file.type || "application/octet-stream", size: file.size, ...(initDrive ? { drive_account: initDrive } : {}) }) });
        const dj = await init.json();
        if (!init.ok) throw new Error(dj.error ?? "upload init failed");
        if (upCancelAll.current) throw new Error("cancelled");
        setItem(key, { status: "uploading", pct: 0 });
        await putWithProgress(dj.signedUrl, file, file.type || "application/octet-stream", key);
        if (upCancelAll.current) throw new Error("cancelled");
        setItem(key, { status: "indexing", pct: null });
        const meta = await fetch("/api/drive/upload", {
          method: "POST", headers: { "content-type": "application/json" },
          // Inside a drive view the bytes mirror into THAT drive folder (the
          // mirror is forced on: uploading "here" means Google). folder stays
          // null — the file lives in the drive tree, not a workspace folder.
          body: JSON.stringify(inDriveView && driveView
            ? { name: file.name, mime: file.type || "application/octet-stream", size: file.size, hash, backends: ["local"], storage_path: dj.path, folder: null, drive_account: driveView.accountId, google_parent: driveView.folderId, usb: usbTarget || undefined }
            : { name: file.name, mime: file.type || "application/octet-stream", size: file.size, hash, backends: ["local"], storage_path: dj.path, folder: curFolder, drive_account: mirrorOff ? null : (driveSel || undefined), usb: usbTarget || undefined })
        });
        const mj = await meta.json().catch(() => ({}));
        if (!meta.ok) throw new Error(mj.error ?? "indexing failed");
        if (inDriveView && driveView) await loadTree(driveView.accountId);
        if (mj.push_error) toast({ text: `"${file.name}" saved locally — Google mirror skipped: ${mj.push_error}`, tone: "err" });
        if (mj.usb_queued === true) toast({ text: `"${file.name}" queued for office-USB copy (agent picks it up).`, tone: "ok" });
        else if (typeof mj.usb_queued === "string") toast({ text: `"${file.name}" USB queue failed: ${mj.usb_queued}`, tone: "err" });
        setItem(key, { status: "done", pct: 100 });
        ok++;
      } catch (e) {
        // Aborts surface as DOMExceptions — report the honest word instead.
        const msg = upCancelAll.current ? "cancelled" : e instanceof Error ? e.message : "upload failed.";
        setItem(key, { status: "error", error: msg });
      }
    }
    upAbort.current = null;
    if (fileRef.current) fileRef.current.value = "";
    // The panel is the summary now (its header is a live region) — no
    // end-of-batch toast to double-announce it.
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
    if (r.ok) { toast({ text: `Renamed to "${name}".`, tone: "ok" }); setRenameTarget(null); refreshAll(); }
    else toast({ text: d.error ?? "Couldn't rename.", tone: "err" });
  }

  const folderDeleting = useRef(false);
  async function deleteFolder() {
    const target = confirmFolderDelete;
    if (!target || folderDeleting.current) return; // one click, one request, one toast
    folderDeleting.current = true;
    setConfirmFolderDelete(null);
    try {
      const r = await fetch("/api/folders", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ folder_id: target.id }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        const n = d.binned ?? 0;
        toast({ text: `Folder "${target.name}" deleted${n ? ` — ${n} file${n === 1 ? "" : "s"} moved to the Recovery Bin` : ""}.`, tone: "ok" });
        setSelKey(null);
        refreshAll();
      } else toast({ text: d.error ?? "Couldn't delete folder.", tone: "err" });
    } finally {
      folderDeleting.current = false;
    }
  }

  async function syncGoogle() {
    setSyncing(true);
    try {
      // Per account: chain that account's pages, then move to the next account
      // the server names (nextAccountId). One page per request per account —
      // no request ever walks a whole drive (HTTP 502-proof).
      const accts = accounts.length ? accounts : [{ id: "", label: "Primary" }];
      let ins = 0, upd = 0, pages = 0, swept = 0;
      const labels: string[] = [];
      for (const a of accts) {
        let token: string | null = null;
        for (let guard = 0; guard < 51; guard++) {
          const body: { pageToken: string | null; accountId?: string } = { pageToken: token };
          if (a.id) body.accountId = a.id;
          const r: Response = await fetch("/api/drive/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
          const d: { inserted?: number; updated?: number; sweptDeleted?: number; sweptUnpinned?: number; done?: boolean; nextPageToken?: string | null; nextAccountId?: string | null; accountLabel?: string; error?: string } = await r.json().catch(() => ({}));
          if (!r.ok) { toast({ text: d.error ?? "Sync failed.", tone: "err" }); return; }
          ins += d.inserted ?? 0; upd += d.updated ?? 0; swept += (d.sweptDeleted ?? 0) + (d.sweptUnpinned ?? 0); pages++;
          if (d.accountLabel && !labels.includes(d.accountLabel)) labels.push(d.accountLabel);
          if (d.done) break;
          // Server-driven hop: done with this account but another remains.
          if (d.nextAccountId && d.nextAccountId !== a.id) break;
          token = d.nextPageToken ?? null;
          if (!token) break;
        }
      }
      toast({ text: `Google sync done${labels.length ? ` (${labels.join(" + ")})` : ""}: ${ins} new, ${upd} updated${swept ? `, ${swept} gone from Drive retired` : ""} (${pages} page${pages === 1 ? "" : "s"}).`, tone: "ok" });
      refreshAll();
    } finally {
      setSyncing(false);
    }
  }

  // Drive tree data: fetched once per opened drive (folders + files, capped).
  // loadTree is also called after creating/uploading inside the drive view so
  // new Google folders/files appear immediately (no Sync wait). The sequence
  // guard drops stale responses when drives are switched quickly.
  const treeSeq = useRef(0);
  async function loadTree(accountId: string) {
    const at = ++treeSeq.current;
    setTree(null);
    setTreeRoot(null);
    setTreeLoading(true);
    setTreeError(null);
    try {
      const r = await fetch(`/api/drive/tree?accountId=${accountId}`, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `tree ${r.status}`);
      }
      const d = await r.json().catch(() => ({}));
      if (at !== treeSeq.current) return;
      setTreeRoot(typeof d.rootId === "string" && d.rootId ? d.rootId : null);
      setTree((d.results ?? []).map((t: { id: string; name: string; mime: string; size: number; google_file_id: string; google_parent_id: string | null }) => ({
        id: t.id, name: t.name, mime: t.mime, size: t.size ?? 0, googleId: t.google_file_id, parent: t.google_parent_id
      })));
      setTreeLoading(false);
    } catch (e) {
      if (at !== treeSeq.current) return;
      setTreeLoading(false);
      setTreeError(e instanceof Error ? e.message : "Couldn't load this drive's tree.");
    }
  }
  useEffect(() => {
    if (!driveView) { setTree(null); setTreeRoot(null); return; }
    void loadTree(driveView.accountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveView?.accountId]);

  function openDrive(accountId: string) {
    closePaneOnPhone();
    if (nav.kind !== "root" || nav.path.length) go({ kind: "root", path: [] });
    setTagSel([]); setTagFilter(null); setQ("");
    setDriveView({ accountId, folderId: null, path: [] });
    clearSel(); setInfoOpen(false); setCtx(null);
    setLoadError(null);
  }
  // Tag addressing: WHAT gets the tag. Local folders tag the folders-table row;
  // Google Drive folders are file_index rows (folder mime), so they tag as
  // kind "file" with the index id — tagging them as kind "folder" 404s (wrong
  // table) and their dots never render. Drive-tree rows carry the index id
  // explicitly; live (unsynced) rows have nothing to attach to → null.
  function tagTarget(r: Row): { kind: TagKind; id: string } | null {
    if (r.kind === "file" && r.file && !r.id.startsWith("g:")) return { kind: "file", id: r.file.id };
    if (r.kind === "folder" && r.googleFolder && r.file) return { kind: "file", id: r.file.id };
    if (r.kind === "folder" && r.folder) return { kind: "folder", id: r.folder.id };
    if (r.indexId) return { kind: "file", id: r.indexId };
    return null;
  }
  const taggable = (r: Row) => tagTarget(r) !== null;
  const rowTags = (r: Row): Tag[] => {
    const t = tagTarget(r);
    return t ? tg.idsOf(t.kind, t.id).map((id) => tg.byId.get(id)).filter(Boolean) as Tag[] : [];
  };
  function toggleTagFilter(id: string) {
    closePaneOnPhone();
    setDriveView(null);
    setTagFilter(null);
    if (nav.kind !== "root") go({ kind: "root", path: [] });
    setTagSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    // Tag search and text search shadow each other (rows pick one branch) —
    // clear the query so enabling a tag can't silently hide behind it.
    setQ("");
    clearSel();
  }

  function copyFile(f: FileRow, cut = false) {
    const c = { id: f.id, name: f.name, cut };
    setClip(c);
    try { localStorage.setItem("eiden-clip", JSON.stringify(c)); } catch { /* ignore */ }
    toast({ text: cut ? `Cut "${f.name}" — right-click → Paste to move it.` : `Copied "${f.name}" — right-click → Paste to duplicate it.`, tone: "ok" });
  }

  async function copyToUsb(r: Row) {
    if (!r.file || usbBusy) return;
    setUsbBusy(r.id);
    const res = await fetch("/api/drive/usb", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id: r.id }) });
    const d = await res.json().catch(() => ({}));
    setUsbBusy(null);
    if (!res.ok) toast({ text: d.error ?? "Couldn't queue USB copy.", tone: "err" });
    else toast({ text: `"${r.name}" queued for office-USB copy (agent picks it up).`, tone: "ok" });
  }

  async function pasteClip() {
    if (!clip || clipBusy) return;
    setClipBusy(true);
    // Cut = move (relocate, nothing duplicated); copy = duplicate. Inside a
    // drive view both land in the open Google folder; otherwise the workspace
    // folder you're standing in.
    const cut = (clip as { cut?: boolean }).cut === true;
    const url = cut ? "/api/drive/move" : "/api/drive/copy";
    const body = cut
      ? inDriveView && driveView
        ? { file_id: clip.id, folder: null, ...(driveView.folderId ? { google_parent: driveView.folderId } : {}) }
        : { file_id: clip.id, folder: curFolder }
      : inDriveView && driveView
        ? { file_id: clip.id, folder: null, ...(driveView.folderId ? { google_parent: driveView.folderId } : {}) }
        : { file_id: clip.id, folder: curFolder };
    const r = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const d = await r.json().catch(() => ({}));
    setClipBusy(false);
    if (!r.ok) { toast({ text: d.error ?? (cut ? "Couldn't move." : "Couldn't paste."), tone: "err" }); return; }
    if (cut) { setClip(null); try { localStorage.removeItem("eiden-clip"); } catch { /* ignore */ } }
    toast({ text: cut ? `Moved "${clip.name}".` : `Pasted as "${d.name}".`, tone: "ok" });
    if (inDriveView && driveView) await loadTree(driveView.accountId);
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

  // Row menu from right-click or the ⋯ button, clamped inside the viewport on any screen.
  function openRowMenu(e: React.MouseEvent, r: Row) {
    e.preventDefault(); e.stopPropagation();
    setSelKey(r.key);
    const W = 218, H = 420;
    const x = e.type === "contextmenu" ? e.clientX : (e.currentTarget as HTMLElement).getBoundingClientRect().right - W;
    const y = e.type === "contextmenu" ? e.clientY : (e.currentTarget as HTMLElement).getBoundingClientRect().bottom + 4;
    setCtx({ x: Math.max(8, Math.min(x, window.innerWidth - W - 8)), y: Math.max(8, Math.min(y, window.innerHeight - Math.min(H, window.innerHeight - 16) - 8)), row: r });
  }

  // ── view helpers ──
  const title = nav.kind === "recent" ? "Recent" : nav.kind === "docs" ? "Documents" : nav.kind === "bin" ? "Recovery Bin"
    : curFolder ? folderById.get(curFolder)?.name ?? "Folder" : "Workspace";
  const crumbs: { label: string; onClick?: () => void; folder?: boolean }[] = [{ label: "Workspace", onClick: () => go({ kind: "root", path: [] }) }];
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
    <section aria-label="File explorer" className="relative h-full min-h-[420px] sm:min-h-[520px] flex border border-line rounded-lg bg-surface overflow-hidden">
      {/* ── Favorites / Tags pane ── (static column ≥ 768 px, overlay with backdrop below) */}
      {pane && <div className="md:hidden absolute inset-0 z-[15] bg-black/25" onClick={() => setPane(false)} aria-hidden="true" />}
      <aside aria-label="Favorites and tags"
        className={`${pane === null ? "hidden md:flex" : pane ? "flex" : "hidden"} absolute md:static inset-y-0 left-0 z-20 w-[min(272px,85%)] md:w-[220px] xl:w-[232px] shrink-0 flex-col bg-soft border-r border-line px-3 py-3 overflow-y-auto shadow-pop md:shadow-none`}>
        <button onClick={() => setFavOpen((o) => !o)} aria-expanded={favOpen} className="flex items-center justify-between px-2 min-h-[44px] text-[13px] text-muted">
          Favorites {favOpen ? <ChevronDown size={16} className="text-brand" /> : <ChevronRight size={16} className="text-brand" />}
        </button>
        {favOpen && (
          <div className="flex flex-col gap-1 mb-2">
            {favItem(nav.kind === "recent", () => go({ kind: "recent", path: [] }), <Clock size={19} strokeWidth={1.6} />, "Recent")}
            {favItem(nav.kind === "docs", () => go({ kind: "docs", path: [] }), <FileText size={19} strokeWidth={1.6} />, "Documents")}
            {favItem(nav.kind === "bin", () => go({ kind: "bin", path: [] }), <Trash2 size={19} strokeWidth={1.6} />, "Recovery Bin", bin.length)}
            {favItem(nav.kind === "root" && !tagFilter && tagSel.length === 0 && !driveView, () => { setDriveView(null); setTagSel([]); setTagFilter(null); go({ kind: "root", path: [] }); }, <House size={19} strokeWidth={1.6} />, "Workspace")}
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
                  <button key={d} onClick={() => { if (tagFilter === d) setTagFilter(null); else { setTagSel([]); setDriveView(null); if (nav.kind !== "root" || nav.path.length) go({ kind: "root", path: [] }); setTagFilter(d); setQ(""); clearSel(); } closePaneOnPhone(); }}
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
        <div className="shrink-0 min-h-[56px] px-2 sm:px-3 flex flex-wrap items-center gap-x-1.5 sm:gap-x-2 gap-y-1.5 py-1.5">
          <button onClick={() => setPane((p) => !(p ?? true))} aria-label="Toggle favorites pane" className="size-11 grid place-items-center rounded-md hover:bg-tint"><MenuIcon size={21} strokeWidth={1.6} /></button>
          <span className="hidden sm:block h-5 border-l border-line mx-1" />
          <button onClick={back} disabled={hi === 0} aria-label="Back" className="hidden sm:grid size-11 place-items-center rounded-md bg-tint text-brand disabled:opacity-40"><ChevronLeft size={18} /></button>
          <button onClick={forward} disabled={hi >= hist.length - 1} aria-label="Forward" className="hidden sm:grid size-11 place-items-center rounded-md bg-tint text-brand disabled:opacity-40"><ChevronRight size={18} /></button>
          <h2 title={title} className="ml-1 sm:ml-2 min-w-0 flex-1 sm:flex-none text-[15px] sm:text-[16px] text-ink/90 truncate sm:max-w-[30%] lg:max-w-[40%]">{title}</h2>

          {/* Search: its own full-width row on phones, inline from 640 px. */}
          <div className="relative order-last basis-full sm:order-none sm:basis-auto sm:ml-auto">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search files"
              className="w-full sm:w-40 lg:w-52 xl:w-64 min-h-[44px] pl-8 pr-2 rounded-md border border-line bg-surface text-[16px] sm:text-[13px] placeholder:text-muted focus:border-brand focus:outline-none" />
          </div>
          <div className="flex items-center gap-1 sm:gap-1.5">
            <div role="group" aria-label="View" className="flex rounded-md overflow-hidden">
              <button onClick={() => switchView("list")} aria-pressed={view === "list"} aria-label="List view" className={`size-11 grid place-items-center ${view === "list" ? "bg-tint text-brand" : "text-muted hover:bg-tint/60"}`}><LayoutList size={19} strokeWidth={1.6} /></button>
              <button onClick={() => switchView("grid")} aria-pressed={view === "grid"} aria-label="Grid view" className={`size-11 grid place-items-center ${view === "grid" ? "bg-tint text-brand" : "text-muted hover:bg-tint/60"}`}><LayoutGrid size={19} strokeWidth={1.6} /></button>            </div>
            <span className="hidden sm:block h-5 border-l border-line mx-0.5" />
            {/* Upload: action + destination picker (Supabase, Drive, USB — each toggleable). */}
            <div className="flex items-stretch h-11 rounded-lg bg-brand text-white shadow-[0_1px_2px_rgba(60,30,140,.3)]">
              <button onClick={() => fileRef.current?.click()} disabled={uploadActive || (supaOff && mirrorOff && !inDriveView)}
                title={destSummary()}
                className="px-3.5 flex items-center gap-2 text-[13.5px] font-medium hover:bg-white/12 active:bg-white/20 disabled:opacity-60 transition-colors rounded-l-lg">
                {uploadActive ? <Ring className="size-4" /> : <Upload size={16} strokeWidth={2.2} />} <span className="hidden sm:inline">{uploadActive ? "Uploading…" : "Upload"}</span>
              </button>
              <span className="my-2.5 w-px bg-white/30" aria-hidden="true" />
              <Menu label="Choose upload destinations" align="right" rootClassName="h-full"
                triggerClassName="h-full w-9 grid place-items-center rounded-r-lg hover:bg-white/12 active:bg-white/20 transition-colors"
                trigger={<ChevronDown size={15} strokeWidth={2.4} />}
                items={[
                  { label: "Supabase", hint: supaOff ? "Off — uploads skip Supabase" : "On — every upload lands here first", icon: !supaOff ? <Check size={14} /> : undefined, onSelect: toggleSupa },
                  "sep",
                  { label: "Mirror to Google Drive", hint: mirrorOff ? "Off — Supabase only" : "On", icon: !mirrorOff ? <Check size={14} /> : undefined, onSelect: toggleMirror },
                  ...(!mirrorOff ? [
                    { label: `Auto · most free space${(() => { const r = [...accounts].filter((a) => a.status === "active").sort((x, y) => (y.free ?? -1) - (x.free ?? -1))[0]; return r ? ` (${r.label})` : ""; })()}`,
                      icon: driveSel === "" ? <Check size={14} /> : undefined, onSelect: () => chooseUploadDrive("") },
                    ...accounts.filter((a) => a.status === "active").map((a) => ({
                      label: `${a.label} · ${a.free !== null ? `${formatBytes(a.free)} free` : "quota unknown"}`,
                      icon: driveSel === a.id ? <Check size={14} /> : undefined, onSelect: () => chooseUploadDrive(a.id)
                    }))
                  ] : []),
                  "sep",
                  { label: "Also copy to office USB", hint: supaOff ? "Needs Supabase on — USB copies pull from Storage" : "Queued — agent copies when online", icon: usbTarget ? <Check size={14} /> : undefined, disabled: supaOff, onSelect: toggleUsb }
                ]} />
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
                { label: syncing ? "Syncing from Google…" : "Sync from Google", icon: syncing ? <Ring className="size-3.5" /> : <CloudDownload size={14} />, disabled: syncing, onSelect: syncGoogle },
                { label: "Refresh", icon: <RefreshCw size={14} />, onSelect: () => load(q) },
                "sep",
                { label: "Also copy uploads to office USB", hint: supaOff ? "Needs Supabase on" : undefined, icon: usbTarget ? <Check size={14} /> : undefined, disabled: supaOff, onSelect: toggleUsb }
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
            {/* Searching while a drive is open searches ALL files (the drive
                filter needs an empty query): say so, or uploads land somewhere
                the user isn't looking. Clear the search to return to the drive. */}
            {!loading && driveView && nav.kind === "root" && !!q.trim() && (
              <div className="shrink-0 mx-3 mt-2 px-3 py-2 rounded-lg border border-line bg-soft text-[12.5px] text-ink/80" role="status">
                Searching all files — not just this drive.{" "}
                <button onClick={() => setQ("")} className="text-brand font-medium hover:underline min-h-[32px]">Clear to return to the drive</button>
              </div>
            )}
            {driveView && treeError && !treeLoading && (
              <div className="shrink-0 mx-3 mt-2 p-3 rounded-lg border border-danger/40 bg-danger/5 text-[13px]" role="alert">
                <strong>Couldn't load this drive's folders:</strong> {treeError}{" "}
                <button onClick={() => loadTree(driveView.accountId)} className="text-brand font-medium hover:underline min-h-[36px]">Retry</button>
              </div>
            )}
            {!driveView && orphanCount > 0 && (
              <div className="shrink-0 mx-3 mt-2 px-3 py-2.5 rounded-lg border border-line bg-soft text-[12.5px] text-ink/80" role="status">
                <p>
                  <strong>{orphanCount} pre-scope leftover{orphanCount === 1 ? "" : "s"}</strong> — old Google rows no drive owns, visible only to you.
                  Clear them, then run <strong>Sync from Google</strong> (More actions menu) to rebuild the index inside the current scope.
                </p>
                <p className="mt-1 text-muted">Clear deletes the orphan rows and detaches their audit history. Storage bytes are kept. Drive bytes are never touched.</p>
                <button onClick={() => setConfirmClearOrphans(true)} disabled={clearing}
                  className="mt-2 min-h-[40px] px-4 rounded-md bg-brand text-white text-[13px] font-medium disabled:opacity-60 hover:brightness-110 active:brightness-95 transition">
                  {clearing ? "Clearing…" : `Clear ${orphanCount} leftover${orphanCount === 1 ? "" : "s"} now`}
                </button>
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
                <div aria-busy="true" aria-label="Loading files" className="flex-1 min-h-[300px] flex flex-col items-center justify-center gap-4 p-8">
                  <SparkleLoader size={84} label="Reading drive" />
                  <p className="text-[13px] text-muted" role="status">Reading drive…</p>
                </div>
              ) : loadError ? (
                <div className="h-full min-h-[260px] grid place-items-center p-8 text-center" role="alert">
                  <div className="max-w-sm">
                    <p className="text-[15px] font-medium">Couldn't load this view</p>
                    <p className="mt-2 text-[13px] text-muted leading-relaxed">{loadError}</p>
                    <div className="mt-4 flex gap-2 justify-center flex-wrap">
                      <button onClick={() => load(q)} className="min-h-[44px] px-5 rounded-md bg-brand text-white text-sm font-medium">Retry</button>
                      <a href="/api/health" target="_blank" rel="noreferrer" className="min-h-[44px] px-4 inline-flex items-center rounded-md border border-line text-sm hover:bg-tint">Check server health</a>
                    </div>
                  </div>
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
                            <button onClick={(e) => { e.stopPropagation(); restore(b.file_id, fi?.name ?? "?"); }} disabled={restoreBusy === b.file_id} className="min-h-[44px] px-2 text-[12px] text-brand flex items-center gap-1 hover:underline disabled:opacity-60">{restoreBusy === b.file_id ? <Ring className="size-3.5" /> : <Undo2 size={14} />} Restore</button>
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
                <div role="grid" aria-label={`${rows.length} items`} aria-rowcount={rows.length + 1} className="min-w-[420px]">
                  <div role="row" className="frow sticky top-0 z-10 h-10 px-3 sm:px-4 bg-head text-[14px] sm:text-[15px] text-ink/90 border-y border-line">
                    <button role="columnheader" aria-sort={ariaSort("name")} onClick={(e) => { e.stopPropagation(); sortBy("name"); }} className="text-left flex items-center gap-1 pl-[26px]">Name {arrow("name")}</button>
                    <span role="columnheader" className="c-tags">Tags</span>
                    <span role="columnheader" className="c-loc">Location</span>
                    <button role="columnheader" aria-sort={ariaSort("updated")} onClick={(e) => { e.stopPropagation(); sortBy("updated"); }} className="c-mod text-left items-center gap-1">Modified {arrow("updated")}</button>
                    <button role="columnheader" aria-sort={ariaSort("size")} onClick={(e) => { e.stopPropagation(); sortBy("size"); }} className="text-left flex items-center gap-1">Size {arrow("size")}</button>
                    <button role="columnheader" aria-sort={ariaSort("kind")} onClick={(e) => { e.stopPropagation(); sortBy("kind"); }} className="c-kind text-left items-center gap-1">Kind {arrow("kind")}</button>
                  </div>
                  {pg.pageItems.map((r, ri) => {
                    const on = selSet.has(r.key);
                    return (
                      <div key={r.key} role="row" tabIndex={0} aria-selected={on}
                        onPointerDown={notePointer} onClick={(e) => clickRow(e, r, ri)}
                        onDoubleClick={() => open(r)}
                        onKeyDown={(e) => onRowKey(e, r)}
                        onContextMenu={(e) => openRowMenu(e, r)}
                        className={`frow min-h-[44px] sm:min-h-[36px] px-3 sm:px-4 border-b border-line/70 cursor-default select-none transition-colors ${on ? "bg-tint text-brand" : "hover:bg-tint/40"}`}>
                        <div role="gridcell" className="flex items-center gap-2 min-w-0" style={{ paddingLeft: r.depth * 20 }}>
                          {r.kind === "folder" && r.expandable
                            ? <button onClick={(e) => { e.stopPropagation(); toggleExpand(r.id); }} aria-label={expanded.has(r.id) ? `Collapse ${r.name}` : `Expand ${r.name}`} aria-expanded={expanded.has(r.id)}
                                className="size-[18px] grid place-items-center text-muted hover:text-brand shrink-0">{expanded.has(r.id) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
                            : <span className="w-[18px] shrink-0" />}
                          {/* Fixed icon slot: covers, page icons and folders all share one column, so names line up. */}
                          <span className="w-9 h-9 shrink-0 grid place-items-center">
                            {r.kind === "file" && r.file
                              ? <FileThumb file={r.file} size={34} />
                              : <FileIcon name={r.name} mime={r.file?.mime} folder={r.kind === "folder"} size={26} />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[14.5px] sm:text-[15px] truncate">{r.name}</span>
                            {/* Phone: the hidden Modified column moves under the name. */}
                            <span className="sm:hidden block text-[11px] text-muted truncate">{r.file ? fmtDate(r.file.updated_at ?? r.file.updated) : r.kind === "folder" ? "Folder" : ""}</span>
                          </span>
                          <button onClick={(e) => openRowMenu(e, r)} aria-label={`Actions for ${r.name}`}
                            className="row-more size-9 shrink-0 grid place-items-center rounded-md text-muted hover:bg-tint hover:text-ink"><MoreHorizontal size={17} /></button>
                        </div>
                        <div role="gridcell" className="c-tags"><TagDots tags={rowTags(r)} /></div>
                        <div role="gridcell" className="c-loc text-[11px] text-ink/75 truncate">{locText(r)}</div>
                        <div role="gridcell" className="c-mod text-[11px] text-ink/75 truncate">{r.file ? fmtDate(r.file.updated_at ?? r.file.updated) : "—"}</div>
                        <div role="gridcell" className="text-[11px] text-ink/75 tabular-nums">{r.kind === "folder" ? folderSize(r) : (r.file?.size ? formatBytes(r.file.size) : "—")}</div>
                        <div role="gridcell" className="c-kind text-[11px] text-ink/75 truncate">{r.kind === "folder" ? "Folder" : (r.file ? displayKind(r.file.name, r.file.mime) : "—")}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div role="grid" aria-label={`${rows.length} items`} className="p-2 sm:p-4 grid content-start gap-2 sm:gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(clamp(96px, 26vw, 128px), 1fr))" }}>
                  {pg.pageItems.map((r, ri) => {
                    const on = selSet.has(r.key);
                    const folder = r.kind === "folder";
                    // Covers mode: folders and files share one grid, so mark where
                    // the files begin — otherwise the two sections butt together.
                    const filesBreak = !folder && ri > 0 && pg.pageItems[ri - 1].kind === "folder";
                    return (
                      // role=row with display:contents keeps gridcell ownership
                      // valid for AT without changing the CSS grid layout.
                      <div key={r.key} role="row" style={{ display: "contents" }}>
                      {filesBreak && (
                        <div aria-hidden="true" className="flex items-center gap-2 px-1 pt-3 pb-1" style={{ gridColumn: "1 / -1" }}>
                          <span className="text-[11px] font-medium uppercase tracking-wider text-muted">Files</span>
                          <span className="h-px flex-1 bg-line" />
                        </div>
                      )}
                      <div className="gtile relative min-w-0">
                      <button role="gridcell" aria-selected={on}
                        onPointerDown={notePointer} onClick={(e) => clickRow(e, r, ri)}
                        onDoubleClick={() => open(r)}
                        onKeyDown={(e) => onRowKey(e, r)}
                        onContextMenu={(e) => openRowMenu(e, r)}
                        className={`w-full flex flex-col items-center gap-2 p-3 rounded-lg text-center transition-colors ${!folder ? "min-h-[152px]" : "min-h-[104px]"} ${on ? "bg-tint text-brand" : "hover:bg-tint/40"} ${folder ? "border border-line/60 bg-soft/40" : ""}`}>
                        {!folder && r.file
                          ? <FileThumb file={r.file} size={72} />
                          : <FileIcon name={r.name} mime={r.file?.mime} folder={folder} size={64} />}
                        <span title={r.name} className="text-[12.5px] leading-tight break-all line-clamp-2">{r.name}</span>
                        {rowTags(r).length > 0 && <TagDots tags={rowTags(r)} />}
                      </button>
                      <button onClick={(e) => openRowMenu(e, r)} aria-label={`Actions for ${r.name}`}
                        className="row-more absolute top-1 right-1 size-8 grid place-items-center rounded-md bg-surface/85 text-muted hover:text-ink hover:bg-tint"><MoreHorizontal size={16} /></button>
                      </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {nav.kind !== "bin" && hasMore && !loading && (
                <div ref={moreRef} aria-hidden="true" className="h-1 shrink-0" />
              )}
              {loadingMore && (
                <div className="p-4 flex items-center justify-center gap-3" role="status">
                  <Dots className="w-12 text-brand" label="Loading more files" />
                  <p className="text-[13px] text-muted">Loading more…</p>
                </div>
              )}
            </div>
            {/* Bulk action bar */}
            {selSet.size > 1 && (
              <div className="shrink-0 px-3 py-2 border-t border-line bg-surface flex flex-wrap items-center gap-2" role="toolbar" aria-label={`${selSet.size} selected`}>
                <span className="text-[13px] font-medium">{selSet.size} selected</span>
                <span className="flex-1" />
                <button onClick={bulkDownload} className="min-h-[40px] px-3 rounded-md border border-line text-[13px] hover:bg-tint">Download</button>
                {nav.kind !== "bin" && (
                  <button onClick={() => setConfirmBulk(true)} className="min-h-[40px] px-3 rounded-md border border-danger/40 text-danger text-[13px]">Trash</button>
                )}
                <button onClick={clearSel} className="min-h-[40px] px-3 rounded-md text-[13px] text-muted hover:bg-tint">Clear</button>
              </div>
            )}
            <div className="shrink-0 border-t border-line px-3 empty:hidden"><Pagination pager={nav.kind === "bin" ? binPg : pg} noun={nav.kind === "bin" ? "files" : "items"} /></div>
            <p className="shrink-0 h-8 px-4 flex items-center text-[11px] text-muted border-t border-line" role="status">
              {nav.kind === "bin" ? `${bin.length} in bin` : `${folderCount} folders · ${fileRows.length} files · ${formatBytes(totalSize)}${hasMore && !loading ? " · more below — scroll to load" : ""}`}
            </p>
          </div>
          {/* Details */}
          {showInfo && sel && (
            <div className="lg:hidden fixed inset-0 z-[29] bg-black/25" onClick={() => { setSelKey(null); setInfoOpen(false); }} aria-hidden="true" />
          )}
          {showInfo && sel && (
            <aside aria-label="Details"
              className="fixed lg:static inset-x-0 bottom-0 z-30 lg:z-auto max-h-[80dvh] lg:max-h-none w-full sm:max-w-[520px] sm:mx-auto lg:mx-0 lg:w-[280px] xl:w-[296px] shrink-0 overflow-y-auto bg-surface border-t sm:border-x lg:border-x-0 lg:border-t-0 lg:border-l border-line rounded-t-2xl lg:rounded-none shadow-pop lg:shadow-none p-4 pb-[max(16px,env(safe-area-inset-bottom))] flex flex-col pop-in">
              <button onClick={() => { setSelKey(null); setInfoOpen(false); }} aria-label="Close details" className="self-end -mt-1 -mr-1 mb-1 size-11 grid place-items-center rounded-md hover:bg-tint text-muted"><X size={16} /></button>
              <div className="h-[160px] sm:h-[200px] rounded-lg border border-line bg-soft grid place-items-center overflow-hidden">
                {/* Same cover pipeline as the grid (signed-URL flow + Google
                    thumbs): the old bare download URL 403'd Storage images. */}
                {sel.file && (classify(sel.file.name, sel.file.mime) === "IMAGE" || classify(sel.file.name, sel.file.mime) === "VIDEO") && !sel.id.startsWith("g:")
                  ? <FileThumb file={sel.file} size={196} />
                  : <FileIcon name={sel.name} mime={sel.file?.mime} folder={sel.kind === "folder"} size={132} />}
              </div>
              <div className="mt-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium break-all">{sel.name}</p>
                  <p className="text-[11px] text-muted">{sel.kind === "folder" ? "Folder" : (sel.file ? displayKind(sel.file.name, sel.file.mime) : "Folder")}</p>
                </div>
                {sel.file?.size ? <span className="text-[11px] text-ink/75 shrink-0">{formatBytes(sel.file.size)}</span> : null}
              </div>
              <dl className="mt-3 text-[12px]">
                {detailRows(sel).map(([k, v]) => {
                  // Owner/SHA-256 keep click-to-copy: truncated ids are useless
                  // without a way to recover the full value.
                  const copyable = k === "Owner" || k === "SHA-256";
                  const full = k === "Owner" ? sel.file?.owner : sel.file?.hash;
                  const canCopy = copyable && !!full;
                  return (
                    <div key={k} className="flex items-center justify-between gap-3 py-2.5 border-b border-line">
                      <dt className="text-ink/80 shrink-0">{k}</dt><dd
                        className={`text-[11.5px] text-ink/75 text-right truncate${canCopy ? " cursor-pointer hover:text-brand" : ""}`}
                        title={canCopy ? `${v} (click to copy)` : v}
                        onClick={canCopy ? () => {
                          navigator.clipboard?.writeText(full as string).then(
                            () => toast({ text: `${k} copied.`, tone: "ok" }),
                            () => toast({ text: "Couldn't copy.", tone: "err" }));
                        } : undefined}
                      >{v}</dd>
                    </div>
                  );
                })}
              </dl>
              <div className="mt-3">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] text-ink/80">Tags</p>
                  {(() => {
                    const t = tagTarget(sel);
                    return t && nav.kind !== "bin" ? (
                      <button onClick={() => setTagPicker({ kind: t.kind, id: t.id, name: sel.name })}
                        className="min-h-[36px] px-2 -mr-2 text-[12px] text-brand font-medium inline-flex items-center gap-1 hover:underline"><Plus size={13} /> Add tag</button>
                    ) : null;
                  })()}
                </div>
                <div className="mt-1 flex gap-1.5 flex-wrap">
                  {rowTags(sel).map((t) => {
                    const tt = tagTarget(sel);
                    return <TagChip key={t.id} tag={t} onRemove={nav.kind === "bin" || !tt ? undefined : () => tg.assign(tt.kind, tt.id, t.id, false)} />;
                  })}
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
                  <button onClick={() => restore(sel.id, sel.name)} aria-label="Restore" disabled={restoreBusy === sel.id} className="px-4 min-h-[44px] hover:text-brand disabled:opacity-60">{restoreBusy === sel.id ? <Ring className="size-4" /> : <Undo2 size={19} strokeWidth={1.6} />}</button>
                )}
                {sel.kind === "file" && nav.kind === "bin" && canPurge && (
                  <button onClick={() => setConfirmPurge({ id: sel.id, name: sel.name })} aria-label="Delete permanently" title="Delete permanently" className="px-4 min-h-[44px] text-muted hover:text-danger"><Trash2 size={19} strokeWidth={1.6} /></button>
                )}
                {(sel.kind === "file" || sel.googleFolder) && !sel.id.startsWith("g:") && nav.kind !== "bin" && sel.file && (
                  <button onClick={() => setConfirmTrash(sel.file!)} aria-label="Move to Recovery Bin" className="px-4 min-h-[44px] hover:text-danger"><Trash2 size={19} strokeWidth={1.6} /></button>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* Context menu (right-click, Shift+F10, or Menu key). Unavailable actions
          stay visible but disabled with the reason — nothing silently missing,
          nothing silently dead. Focus lands in the menu; arrows move, Escape closes. */}
      {ctx && (
        <div role="menu" aria-label={`Actions for ${ctx.row.name}`} style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}
          ref={(el) => el?.focus()}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.stopPropagation(); setCtx(null); return; }
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const btns = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not([disabled])'));
            const at = btns.indexOf(document.activeElement as HTMLButtonElement);
            const next = e.key === "ArrowDown" ? btns[(at + 1) % btns.length] : btns[(at - 1 + btns.length) % btns.length];
            next?.focus();
          }}
          className="pop-in fixed z-[70] w-[218px] max-h-[calc(100dvh-16px)] overflow-y-auto py-1.5 rounded-lg bg-surface border border-line shadow-pop text-[13px] outline-none">
          {(() => {
            const r = ctx.row;
            const isLive = r.id.startsWith("g:") && !r.id.startsWith("gdrive:");
            const isGFolder = r.id.startsWith("gdrive:");
            const indexed = !isLive && !isGFolder;
            const needSync = "Sync the drive first — this file isn't indexed yet";
            const items: { label: string; icon?: React.ReactNode; on?: () => void; disabled?: boolean; why?: string; danger?: boolean; show?: boolean }[] = [
              { label: "Open", on: () => open(r), show: true },
              { label: "View", icon: <Eye size={14} />, on: () => r.file && setViewFile(toViewFile(r.file)), show: r.kind === "file" },
              { label: "Edit", icon: <Pencil size={14} />,
                on: r.file && indexed && editable(r.file.name, r.file.mime) ? () => setEditFile(toViewFile(r.file!)) : undefined,
                disabled: !(r.file && indexed && editable(r.file.name, r.file.mime)),
                why: !r.file ? undefined : !indexed ? needSync : "This format is view-only",
                show: r.kind === "file" },
              { label: "Copy", icon: <Copy size={14} />,
                on: r.file && indexed ? () => copyFile(r.file!) : undefined,
                disabled: !(r.file && indexed), why: needSync,
                show: r.kind === "file" },
              { label: "Cut", icon: <Scissors size={14} />,
                on: r.file && indexed ? () => copyFile(r.file!, true) : undefined,
                disabled: !(r.file && indexed), why: needSync || "Cut, then Paste where it should live",
                show: r.kind === "file" || !!r.googleFolder },
              { label: "Get Info", icon: <Info size={14} />, on: () => { setSelKey(r.key); setInfoOpen(true); }, show: true },
              // Tags live in EVERY file/folder menu (Workspace, Recent, Docs,
              // drive tree) — not just Workspace root. Unindexed live rows get
              // a disabled entry with the reason instead of a missing option.
              { label: "Tags…", icon: <TagIcon size={14} />,
                on: (() => { const t = tagTarget(r); return t ? () => setTagPicker({ kind: t.kind, id: t.id, name: r.name }) : undefined; })(),
                disabled: !tagTarget(r),
                why: !tagTarget(r) ? needSync : undefined,
                show: (r.kind === "file" || r.kind === "folder") && nav.kind !== "bin" },
              { label: "Rename", icon: <Pencil size={14} />,
                on: r.kind === "folder" && r.folder ? () => openRename("folder", r.folder!.id, r.folder!.name)
                  : r.kind === "folder" && r.indexId ? () => openRename("file", r.indexId!, r.name)
                  : r.file && indexed ? () => openRename("file", r.id, r.file!.name) : undefined,
                disabled: isLive ? true : (isGFolder && !r.indexId) ? true : !(r.kind === "folder" || (r.kind === "file" && r.file)),
                why: isLive ? needSync : (isGFolder && !r.indexId) ? "Sync the drive first — this folder isn't indexed yet" : undefined,
                show: r.kind === "folder" || r.kind === "file" },
              { label: "Download", icon: <Download size={14} />,
                on: indexed && r.kind === "file" ? () => { window.location.href = `/api/drive/download?file_id=${r.id}`; } : undefined,
                disabled: !(indexed && r.kind === "file"),
                why: r.kind === "file" ? "Preview it instead — direct download needs a sync" : undefined,
                show: r.kind === "file" },
              { label: "Copy to office USB", icon: usbBusy === r.id ? <Ring className="size-3.5" /> : <HardDrive size={14} />,
                on: r.file?.storage_path && !usbBusy ? () => copyToUsb(r) : undefined,
                disabled: !r.file?.storage_path || !!usbBusy,
                why: usbBusy ? "Queuing…" : "Needs a Supabase copy first (Google-only file)",
                show: r.kind === "file" && indexed },
              { label: "Copy link", icon: <Link2 size={14} />, on: () => copyLink(r),
                show: !isLive && !isGFolder && r.kind === "file" },
              { label: "Delete", icon: <Trash2 size={14} />, danger: true,
                on: r.file && indexed ? () => setConfirmTrash(r.file!) : undefined,
                disabled: !(r.file && indexed), why: needSync,
                show: r.kind === "file" },
              { label: "Delete folder", icon: <Trash2 size={14} />, danger: true,
                on: r.folder ? () => setConfirmFolderDelete(r.folder!)
                  : (r.googleFolder && r.file ? () => setConfirmTrash(r.file!)
                  : (r.indexId ? () => setConfirmTrash({ id: r.indexId!, name: r.name, backends: ["google"] }) : undefined)),
                disabled: !r.folder && !(r.googleFolder && r.file) && !r.indexId,
                why: (isGFolder && !r.indexId) ? "Sync the drive first — this folder isn't indexed yet"
                  : r.googleFolder ? "Trashed with everything inside it (90 days, recoverable)" : undefined,
                show: r.kind === "folder" }
            ];
            return items.filter((i) => i.show !== false).map((i) => (
              // Disabled items keep the reason in aria-label: they aren't
              // focusable, so title-only text would be invisible to screen readers.
              <button key={i.label} role="menuitem" disabled={i.disabled} title={i.disabled ? i.why : undefined}
                aria-label={i.disabled && i.why ? `${i.label}: ${i.why}` : undefined}
                onClick={() => { if (i.disabled) return; const fn = i.on; setCtx(null); fn?.(); }}
                className={`w-full flex items-center justify-between gap-2 px-3.5 py-2 text-left hover:bg-tint disabled:opacity-45 disabled:hover:bg-transparent ${i.danger ? "text-danger" : "text-ink"}`}>
                <span className="truncate">{i.label}</span>{i.icon ? <span className="text-muted shrink-0">{i.icon}</span> : null}
              </button>
            ));
          })()}
        </div>
      )}

      {/* Canvas menu (right-click on empty space) */}
      {canvasCtx && (
        <div role="menu" style={{ left: canvasCtx.x, top: canvasCtx.y }} onClick={(e) => e.stopPropagation()}
          className="pop-in fixed z-[70] w-[200px] py-1.5 rounded-lg bg-surface border border-line shadow-pop text-[13px]">
            <button role="menuitem" onClick={() => { setCanvasCtx(null); refreshAll(); }}
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
          <button role="menuitem" disabled={!clip || clipBusy} title={clipBusy ? "Pasting…" : clip ? `Paste "${clip.name}" here` : "Copy a file first"}
            onClick={() => { setCanvasCtx(null); pasteClip(); }}
            className="w-full flex items-center justify-between px-3.5 py-2 text-left hover:bg-tint disabled:opacity-40">
            <span>{clipBusy ? "Pasting…" : <>Paste{clip ? ` "${clip.name.length > 18 ? clip.name.slice(0, 17) + "…" : clip.name}"` : ""}</>}</span>
            <span className="text-muted">{clipBusy ? <Ring className="size-3.5" /> : <ClipboardPaste size={14} />}</span>
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
            <p className="text-[12px] text-muted mt-2">Created inside {inDriveView ? driveDestLabel : `“${title}”`}.</p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowNewFolder(false)} className="min-h-[44px] px-4 rounded-md border border-line text-sm hover:bg-tint">Cancel</button>
            <button disabled={!newName.trim() || folderBusy} className="min-h-[44px] px-4 rounded-md bg-brand text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2">{folderBusy && <Ring className="size-4" />}{folderBusy ? "Creating…" : "Create"}</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={!!confirmPurge} title={`Delete “${confirmPurge?.name}” permanently?`}
        body="This erases the file from Eiden Drive and from Google Drive. It cannot be recovered afterwards — the Recovery Bin is the last safety net."
        confirmLabel="Delete forever" busy={purging} busyLabel="Deleting…" onClose={() => !purging && setConfirmPurge(null)} onConfirm={purge} />

      <ConfirmDialog open={!!confirmTrash} title="Move to Recovery Bin?"
        body={`"${confirmTrash?.name}" stays recoverable for 90 days. Members can never delete permanently.`}
        confirmLabel="Move to Bin" busy={trashBusy} busyLabel="Moving to Bin…" onClose={() => !trashBusy && setConfirmTrash(null)} onConfirm={() => confirmTrash && trash(confirmTrash)} />
      <ConfirmDialog open={confirmBulk} title={`Trash ${selRows.length} files?`}
        body="They stay recoverable in the Recovery Bin for 90 days."
        confirmLabel="Move all to Bin" busy={bulkBusy} busyLabel="Moving to Bin…" onClose={() => !bulkBusy && setConfirmBulk(false)} onConfirm={bulkTrash} />

      <Modal open={!!renameTarget} title={renameTarget?.kind === "folder" ? "Rename folder" : "Rename file"} onClose={() => setRenameTarget(null)} labelId="rn-title" width={400}>
        <form onSubmit={doRename} className="flex flex-col gap-4">
          <div>
            <label htmlFor="rn-name" className="block text-[13px] text-muted">New name</label>
            <input id="rn-name" autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={255}
              className="w-full min-h-[44px] mt-1 bg-transparent border-0 border-b border-[#8f8f9a] focus:border-b-2 focus:border-brand focus:outline-none rounded-none px-0 text-[16px]" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setRenameTarget(null)} className="min-h-[44px] px-4 rounded-md border border-line text-sm hover:bg-tint">Cancel</button>
            <button disabled={!renameValue.trim() || renameBusy} className="min-h-[44px] px-4 rounded-md bg-brand text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2">{renameBusy && <Ring className="size-4" />}{renameBusy ? "Renaming…" : "Rename"}</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={!!confirmFolderDelete} title="Delete folder?"
        body={`"${confirmFolderDelete?.name}" and its subfolders are removed. Files inside move to the Recovery Bin for 90 days and restore to the parent folder.`}
        confirmLabel="Delete" onClose={() => setConfirmFolderDelete(null)} onConfirm={deleteFolder} />

      <ConfirmDialog open={confirmClearOrphans} title={`Clear ${orphanCount} leftover${orphanCount === 1 ? "" : "s"}?`}
        body="This deletes the pre-scope orphan rows and detaches their audit history. Storage bytes are kept. Drive bytes are never touched. Run Sync from Google afterwards to rebuild the index."
        confirmLabel="Clear leftovers" busy={clearing} busyLabel="Clearing…" onClose={() => !clearing && setConfirmClearOrphans(false)} onConfirm={clearOrphans} />

      <UploadPanel
        items={uploadItems} minimized={uploadPanelMin}
        onToggleMin={() => setUploadPanelMin((v) => !v)}
        onDismiss={() => setUploadItems([])}
        onCancel={cancelUploads}
      />
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
