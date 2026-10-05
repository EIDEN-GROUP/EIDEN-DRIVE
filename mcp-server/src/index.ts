// EIDEN MCP server — per-member AI scope.
// Identity: `ai:{userId}`. Policy: add+view PERSONAL_{userId} only; edit/delete/trash/share denied.
// Every call must append to audit_logs with actor_name `ai:{username}`. Wire transport (stdio/SSE)
// to your agent host (Claude/Opencode) at the end; tool shapes below are final.
export const TOOLS = [
  {
    name: "drive.list",
    scope: "owner == requester && path startsWith /PERSONAL_{userId}",
    input: { folder: "string?", q: "string?" },
    denies: ["edit", "delete", "trash", "share", "perm-delete"]
  },
  {
    name: "drive.read",
    scope: "owner == requester",
    input: { file_id: "string" },
    audits_as: "ai-read"
  },
  {
    name: "drive.upload",
    scope: "owner == requester && dest startsWith /PERSONAL_{userId}",
    input: { name: "string", bytes_base64: "string", mime: "string?" },
    audits_as: "ai-upload",
    note: "creates v1 only — no overwrite, no delete"
  }
] as const;

export function assertAIAllowed(tool: string, userId: string, path: string): boolean {
  if (!TOOLS.some((t) => t.name === tool)) return false;
  return path.startsWith(`/PERSONAL_${userId}`) || path.startsWith("PERSONAL_");
}
