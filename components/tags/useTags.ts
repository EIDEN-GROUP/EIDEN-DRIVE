"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "../ui/Toast";

export interface Tag { id: string; name: string; color: string; created_by: string | null }
export type TagKind = "file" | "folder";
export const SWATCHES = ["#e5322d", "#f59e0b", "#eab308", "#22c32e", "#0ea5a4", "#2331e0", "#5b3fd0", "#a855f7", "#ec4899", "#64748b"];

/** Tags + which files/folders carry them. Optimistic assign/unassign; every call surfaces server errors as toasts. */
export function useTags() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [files, setFiles] = useState<Record<string, string[]>>({});
  const [folders, setFolders] = useState<Record<string, string[]>>({});
  // Inheritance supply (complete ancestor inputs from GET /api/tags):
  // workspace folder parents + google-folder rows for Drive chains.
  const [folderParents, setFolderParents] = useState<Record<string, string | null>>({});
  const [googleFolders, setGoogleFolders] = useState<{ id: string; google_id: string; parent: string | null; account: string | null }[]>([]);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/tags");
      if (!r.ok) return; // tables not migrated yet (0013) or signed out — tagging UI simply stays empty
      const d = await r.json();
      setTags(d.tags ?? []); setFiles(d.files ?? {}); setFolders(d.folders ?? {});
      setFolderParents(d.folderParents ?? {}); setGoogleFolders(d.googleFolders ?? []);
    } catch { /* offline */ } finally { setReady(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const idsOf = useCallback((kind: TagKind, id: string): string[] => (kind === "file" ? files : folders)[id] ?? [], [files, folders]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const ids of [...Object.values(files), ...Object.values(folders)]) for (const t of ids) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  }, [files, folders]);
  const byId = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  async function create(name: string, color: string): Promise<Tag | null> {
    const r = await fetch("/api/tags", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, color }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast({ text: d.error ?? "Couldn't create the tag.", tone: "err" }); return null; }
    setTags((p) => [...p, d.tag].sort((a, b) => a.name.localeCompare(b.name)));
    return d.tag as Tag;
  }
  async function update(id: string, patch: { name?: string; color?: string }): Promise<boolean> {
    const r = await fetch("/api/tags", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...patch }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast({ text: d.error ?? "Couldn't update the tag.", tone: "err" }); return false; }
    setTags((p) => p.map((t) => (t.id === id ? { ...t, ...patch } : t)).sort((a, b) => a.name.localeCompare(b.name)));
    return true;
  }
  async function remove(id: string): Promise<boolean> {
    const r = await fetch("/api/tags", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast({ text: d.error ?? "Couldn't delete the tag.", tone: "err" }); return false; }
    setTags((p) => p.filter((t) => t.id !== id));
    const strip = (m: Record<string, string[]>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.filter((x) => x !== id)]));
    setFiles(strip); setFolders(strip);
    return true;
  }
  async function assign(kind: TagKind, id: string, tagId: string, on: boolean) {
    const set = kind === "file" ? setFiles : setFolders;
    const apply = (add: boolean) => set((m) => {
      const cur = new Set(m[id] ?? []);
      if (add) cur.add(tagId); else cur.delete(tagId);
      return { ...m, [id]: [...cur] };
    });
    apply(on);
    const r = await fetch("/api/tags/assign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, id, tag_id: tagId, on }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      apply(!on);
      toast({ text: d.error ?? "Couldn't update tags.", tone: "err" });
    } else if (on && d.affected) {
      // Folder (or google-folder row) tags inherit to every descendant at
      // read time — confirm scope.
      const a = d.affected as { folders?: number; files?: number };
      const bits = [a.folders ? `${a.folders} folder${a.folders === 1 ? "" : "s"}` : "", a.files ? `${a.files} file${a.files === 1 ? "" : "s"}` : ""].filter(Boolean).join(" + ");
      if (bits) toast({ text: `Tag applied — inherits to ${bits} inside.`, tone: "ok" });
    } else if (!on && d.affected) {
      const a = d.affected as { folders?: number; files?: number };
      if ((a.folders ?? 0) + (a.files ?? 0) > 0) toast({ text: "Tag removed — descendants no longer inherit it.", tone: "ok" });
    }
  }

  return { tags, byId, counts, ready, idsOf, load, create, update, remove, assign, files, folders, folderParents, googleFolders };
}
export type TagsApi = ReturnType<typeof useTags>;
