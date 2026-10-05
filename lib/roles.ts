import { createClient as createServer } from "./supabase-server";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

export type Role = "admin" | "manager" | "member";

export interface Profile {
  id: string;
  username: string;
  role: Role;
  department_tag: string | null;
}

export const ROLE_RANK: Record<Role, number> = { member: 1, manager: 2, admin: 3 };

export function can(_actor: Role, action: string): boolean {
  // Members: view/add/edit/move + trash-only. Permanent/restore/users/tags = manager+.
  if (action === "perm-delete" || action === "restore" || action === "manage-users" || action === "assign-tag" || action === "create-vault")
    return _actor === "admin" || _actor === "manager";
  if (action === "approve") return _actor === "admin" || _actor === "manager";
  return true; // view/add/edit/move/trash-request
}

export function needsApproval(classification: string, action: string): boolean {
  const sensitive = ["Financial", "Legal", "Contracts", "HR", "Confidential"];
  if (action === "perm-delete") return true;
  if (action === "delete" && sensitive.includes(classification)) return true;
  return false;
}

// Server-side helper: get current profile (null if anon)
export async function getProfile(): Promise<Profile | null> {
  try {
    const supa = createServer();
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return null;
    const { data } = await supa.from("profiles").select("id,username,role,department_tag").eq("id", user.id).single();
    return (data as Profile) ?? null;
  } catch { return null; }
}

export { createClientComponentClient };
