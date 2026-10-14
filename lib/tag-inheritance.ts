// Recursive folder-tag inheritance (pure, client- and server-safe).
//
// Model: DIRECT tags live in file_tags / folder_tags and are the only thing
// ever written. EFFECTIVE tags = direct ∪ inherited-from-ancestors, computed
// at read time — so removing a parent tag, moving an item, renaming or
// deleting a tag can never leave orphaned copies behind, and a direct
// assignment always survives the loss of an inherited one.
//
// Two ancestries (never mixed):
//  - Workspace: folders.parent chain (folder_tags supply the tags).
//  - Google Drive: google_parent_id chain resolved through indexed rows of
//    the SAME drive_account_id (file_tags on those rows supply the tags).
// A dual-homed row (workspace folder + Google pin) unions both — the same
// row renders in both views, and each view's ancestry contributes. Cross-
// drive leakage is impossible: google chains never cross drive_account_id.
//
// Cycles, missing parents, and absurd depths are cut safely (visited set +
// depth cap); results are memoized per ancestor so large folders stay linear.

export interface InheritFile {
  id: string;
  folder: string | null;
  google_parent_id: string | null;
  drive_account_id: string | null;
}

export interface InheritGoogleFolder {
  /** file_index id of the google-folder row */
  id: string;
  google_id: string;
  parent: string | null;
  account: string | null;
}

export interface InheritInput {
  fileDirect: Record<string, string[]>;
  folderDirect: Record<string, string[]>;
  folderParent: Record<string, string | null>;
  googleFolders: InheritGoogleFolder[];
  files: InheritFile[];
}

export interface EffectiveTags {
  /** item id → sorted unique effective tag ids (direct + inherited) */
  files: Record<string, string[]>;
  folders: Record<string, string[]>;
  /** item id → tag id → ancestor ids supplying it (for "remove at source" UX) */
  sources: Record<string, Record<string, string[]>>;
}

const MAX_DEPTH = 200;

const uniq = (ids: Iterable<string>): string[] => [...new Set(ids)].sort();

/** Workspace ancestor folder ids, nearest first. Cycle-safe, depth-capped. */
export function workspaceAncestors(folderId: string | null, parentOf: Map<string, string | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cur = folderId;
  for (let i = 0; i < MAX_DEPTH && cur && !seen.has(cur); i++) {
    seen.add(cur);
    out.push(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return out;
}

export function computeEffectiveTags(input: InheritInput): EffectiveTags {
  const fileDirect = new Map(Object.entries(input.fileDirect).map(([k, v]) => [k, new Set(v)]));
  const folderDirect = new Map(Object.entries(input.folderDirect).map(([k, v]) => [k, new Set(v)]));
  const parentOf = new Map(Object.entries(input.folderParent));
  // google id → folder rows (same google id can index twice across accounts;
  // the account filter below keeps chains from crossing drives).
  const byGoogleId = new Map<string, InheritGoogleFolder[]>();
  for (const g of input.googleFolders) {
    const l = byGoogleId.get(g.google_id) ?? [];
    l.push(g);
    byGoogleId.set(g.google_id, l);
  }

  // Memoized workspace-folder effective sets (each folder computed once no
  // matter how many descendants it has).
  const folderMemo = new Map<string, Set<string>>();
  const folderSources = new Map<string, Map<string, Set<string>>>();
  function folderEffective(id: string, visiting = new Set<string>()): Set<string> {
    const hit = folderMemo.get(id);
    if (hit) return hit;
    const out = new Set(folderDirect.get(id) ?? []);
    const src = new Map<string, Set<string>>();
    const parent = parentOf.get(id) ?? null;
    if (parent && !visiting.has(parent)) {
      visiting.add(id);
      for (const t of folderEffective(parent, visiting)) {
        out.add(t);
        const s = src.get(t) ?? new Set<string>();
        s.add(parent);
        src.set(t, s);
      }
      visiting.delete(id);
    }
    folderMemo.set(id, out);
    folderSources.set(id, src);
    return out;
  }

  // Memoized google-folder effective sets, keyed by index row id. Chains stay
  // inside one drive_account_id; unindexed/missing parents end the chain
  // (fail closed — no tags invented).
  const googleMemo = new Map<string, Set<string>>();
  const googleSources = new Map<string, Map<string, Set<string>>>();
  function googleEffective(row: InheritGoogleFolder, visiting = new Set<string>()): Set<string> {
    const hit = googleMemo.get(row.id);
    if (hit) return hit;
    const out = new Set(fileDirect.get(row.id) ?? []);
    const src = new Map<string, Set<string>>();
    let cur: string | null = row.parent;
    const seen = new Set<string>([row.google_id, ...visiting]);
    for (let i = 0; i < MAX_DEPTH && cur && !seen.has(cur); i++) {
      seen.add(cur);
      const cands = (byGoogleId.get(cur) ?? []).filter((c) => c.account === row.account && !visiting.has(c.id));
      if (!cands.length) break;
      // Same google id indexed twice in one account: union both (defensive).
      for (const c of cands) {
        visiting.add(row.id);
        for (const t of googleEffective(c, visiting)) {
          out.add(t);
          const s = src.get(t) ?? new Set<string>();
          s.add(c.id);
          src.set(t, s);
        }
        visiting.delete(row.id);
      }
      // Continue past the first candidate's parent (they share ancestry).
      cur = cands[0].parent;
    }
    googleMemo.set(row.id, out);
    googleSources.set(row.id, src);
    return out;
  }

  const files: Record<string, string[]> = {};
  const folders: Record<string, string[]> = {};
  const sources: Record<string, Record<string, string[]>> = {};
  const note = (item: string, tag: string, from: string) => {
    const m = (sources[item] ??= {});
    const l = (m[tag] ??= []);
    if (!l.includes(from)) l.push(from);
  };

  // Workspace folders: every known folder gets an effective set (cheap —
  // memoized; unknown ids referenced by files resolve through the same fn).
  const folderIds = new Set<string>([...parentOf.keys(), ...folderDirect.keys()]);
  for (const fid of folderIds) {
    folders[fid] = uniq(folderEffective(fid));
    for (const [t, from] of folderSources.get(fid) ?? []) for (const f of from) note(fid, t, f);
  }

  for (const f of input.files) {
    const eff = new Set(fileDirect.get(f.id) ?? []);
    for (const anc of workspaceAncestors(f.folder, parentOf)) {
      for (const t of folderEffective(anc)) {
        eff.add(t);
        note(f.id, t, anc);
      }
    }
    if (f.google_parent_id) {
      const seen = new Set<string>();
      let cur: string | null = f.google_parent_id;
      for (let i = 0; i < MAX_DEPTH && cur && !seen.has(cur); i++) {
        seen.add(cur);
        const cands: InheritGoogleFolder[] = (byGoogleId.get(cur) ?? []).filter((c) => !f.drive_account_id || c.account === f.drive_account_id);
        if (!cands.length) break;
        for (const c of cands) {
          for (const t of googleEffective(c)) {
            eff.add(t);
            note(f.id, t, c.id);
          }
        }
        cur = cands[0].parent;
      }
    }
    files[f.id] = uniq(eff);
  }
  // Google-folder rows render as folders but address by index id (kind
  // "file" in the UI) — publish their effective sets under files[] too.
  for (const row of input.googleFolders) {
    if (!(row.id in files)) {
      files[row.id] = uniq(googleEffective(row));
      for (const [t, from] of googleSources.get(row.id) ?? []) for (const f of from) note(row.id, t, f);
    }
  }
  return { files, folders, sources };
}

/**
 * Ancestor ids supplying an inherited tag (direct tags are never listed —
 * `sources` only records inherited supply, so callers can distinguish).
 */
export function inheritedFrom(itemId: string, tagId: string, eff: EffectiveTags): string[] {
  return [...(eff.sources[itemId]?.[tagId] ?? [])];
}
