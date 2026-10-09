// EIDEN MCP server — per-member AI scope, stdio transport.
//
// One instance = one member. Required env:
//   EIDEN_URL            Supabase project URL
//   EIDEN_SERVICE_KEY    service-role key (server side only, never in the app)
//   EIDEN_AI_USER_ID     the member's profiles.id this instance acts as
//
// Policy (enforced on EVERY call, server-side):
//   - profiles.allow_ai must be true or the call is refused
//   - list/read/upload touch ONLY rows owned by EIDEN_AI_USER_ID
//   - uploads land in the member's own Storage prefix, v1 only (no overwrite)
//   - every call appends to audit_logs as actor ai:{username}
//
// Run:  npm install && npm run build && npm start
// Hosts (Claude Code / Opencode / any MCP client): point at `node dist/index.js` over stdio.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const URL = process.env.EIDEN_URL ?? "";
const KEY = process.env.EIDEN_SERVICE_KEY ?? "";
const USER_ID = process.env.EIDEN_AI_USER_ID ?? "";
if (!URL || !KEY || !USER_ID) {
  console.error("Missing env: EIDEN_URL, EIDEN_SERVICE_KEY, EIDEN_AI_USER_ID are all required.");
  process.exit(1);
}

const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const BUCKET = "eiden-uploads";
const READ_CAP = 100 * 1024; // tool payload cap for inline file content

async function identity(): Promise<{ username: string } | { error: string }> {
  const { data: p } = await db.from("profiles").select("id,username,allow_ai").eq("id", USER_ID).maybeSingle();
  const row = p as { username: string; allow_ai: boolean } | null;
  if (!row) return { error: `no member with id ${USER_ID} — check EIDEN_AI_USER_ID` };
  if (!row.allow_ai) return { error: "AI access is off for this member (profiles.allow_ai = false)" };
  return { username: row.username };
}

async function audit(username: string, action: string, file_id: string | null, detail: Record<string, unknown>) {
  await db.from("audit_logs").insert({
    actor: USER_ID, actor_name: `ai:${username}`, action, file_id, detail,
    ip: "mcp-stdio", user_agent: "eiden-mcp-server/0.2.0"
  });
}

function fail(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

const server = new McpServer({ name: "eiden-drive", version: "0.2.0" });

server.tool(
  "drive.list",
  "List the files owned by the bound member. Never sees other people's files.",
  { q: z.string().max(120).optional(), limit: z.number().int().min(1).max(100).default(50) },
  async ({ q, limit }) => {
    const id = await identity();
    if ("error" in id) return fail(id.error);
    let query = db.from("file_index").select("id,name,mime,size,backends,updated_at").eq("owner", USER_ID).order("updated_at", { ascending: false }).limit(limit);
    if (q) query = query.ilike("name", `%${q.replace(/[%_]/g, "")}%`);
    const { data, error } = await query;
    if (error) return fail(error.message);
    await audit(id.username, "ai-read", null, { tool: "drive.list", q: q ?? null, count: data?.length ?? 0 });
    return { content: [{ type: "text" as const, text: JSON.stringify(data ?? []) }] };
  }
);

server.tool(
  "drive.read",
  "Read one owned file's metadata, plus inline text when it is small and textual.",
  { file_id: z.string().uuid() },
  async ({ file_id }) => {
    const id = await identity();
    if ("error" in id) return fail(id.error);
    const { data: f } = await db.from("file_index").select("id,name,mime,size,backends,storage_path,storage_bucket,updated_at").eq("id", file_id).eq("owner", USER_ID).maybeSingle();
    if (!f) return fail("not found (or not yours)");
    const row = f as { name: string; mime: string; size: number; storage_path: string | null; storage_bucket: string | null };
    let content: string | null = null;
    if (row.storage_path && row.size <= READ_CAP && /^(text\/|application\/(json|javascript|xml)|.*(md|txt|csv|json|xml)$)/.test(`${row.mime} ${row.name}`)) {
      const { data: blob, error } = await db.storage.from(row.storage_bucket || BUCKET).download(row.storage_path);
      if (!error && blob) {
        const buf = Buffer.from(await blob.arrayBuffer());
        content = buf.toString("utf8");
      }
    }
    await audit(id.username, "ai-read", file_id, { tool: "drive.read" });
    return { content: [{ type: "text" as const, text: JSON.stringify({ ...(f as object), content }) }] };
  }
);

server.tool(
  "drive.upload",
  "Upload a new file as the bound member (v1 only — no overwrite, no delete). Rejects non-members' paths by construction: everything lands under the member's own prefix.",
  { name: z.string().min(1).max(255), bytes_base64: z.string().max(15_000_000), mime: z.string().max(127).default("application/octet-stream") },
  async ({ name, bytes_base64, mime }) => {
    const id = await identity();
    if ("error" in id) return fail(id.error);
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${USER_ID}/mcp-${Date.now()}-${safe}`;
    const bytes = Buffer.from(bytes_base64, "base64");
    const { error: upErr } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
    if (upErr) return fail(`storage upload failed: ${upErr.message}`);
    const { data, error: inErr } = await db.from("file_index").insert({
      name: safe, mime, size: bytes.length, backends: ["local"], owner: USER_ID, folder: null, storage_path: path
    }).select("id").single();
    if (inErr) return fail(`index failed: ${inErr.message}`);
    const fid = (data as { id: string }).id;
    await db.from("versions").insert({ file_id: fid, v: 1, hash: "", actor: USER_ID });
    await audit(id.username, "ai-upload", fid, { tool: "drive.upload", name: safe, size: bytes.length });
    return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, id: fid, name: safe }) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
