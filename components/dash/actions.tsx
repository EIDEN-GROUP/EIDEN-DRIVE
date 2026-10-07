import { Download, Eye, KeyRound, LogIn, Pencil, Plus, RotateCcw, Share2, Trash2, Type, type LucideIcon } from "lucide-react";

// One vocabulary for audit actions, shared by the Activity page and the Security Center.
export interface ActionMeta { verb: string; label: string; color: string; Icon: LucideIcon; change: boolean; sensitive: boolean }

export const ACTIONS: Record<string, ActionMeta> = {
  add: { verb: "added", label: "Added", color: "#22c32e", Icon: Plus, change: true, sensitive: false },
  edit: { verb: "edited", label: "Edited", color: "#2563eb", Icon: Pencil, change: true, sensitive: false },
  rename: { verb: "renamed", label: "Renamed", color: "#0ea5a4", Icon: Type, change: true, sensitive: false },
  download: { verb: "downloaded", label: "Downloaded", color: "#7c3aed", Icon: Download, change: false, sensitive: true },
  trash: { verb: "moved to the Recovery Bin", label: "Moved to bin", color: "#f59e0b", Icon: Trash2, change: true, sensitive: true },
  restore: { verb: "restored", label: "Restored", color: "#22c32e", Icon: RotateCcw, change: true, sensitive: true },
  "perm-delete": { verb: "deleted permanently", label: "Deleted", color: "#e5322d", Icon: Trash2, change: true, sensitive: true },
  share: { verb: "shared", label: "Shared", color: "#0ea5a4", Icon: Share2, change: false, sensitive: true },
  view: { verb: "viewed", label: "Viewed", color: "#64748b", Icon: Eye, change: false, sensitive: false },
  "vault-view": { verb: "opened the Vault", label: "Vault", color: "#e5322d", Icon: KeyRound, change: false, sensitive: true },
  login: { verb: "signed in", label: "Signed in", color: "#22c32e", Icon: LogIn, change: false, sensitive: false }
};
export const actionMeta = (a: string): ActionMeta => ACTIONS[a] ?? { verb: a, label: a, color: "#64748b", Icon: Eye, change: false, sensitive: false };
