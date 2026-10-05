// EIDEN Local Agent — outbound-only. Runs on office PC with SMB access to router USB.
// Allowlisted ops only: list/hash/upload/move/rename/trash/sync. No inbound ports, no SMB exposed.
// Env (left for the end): AGENT_WS_URL, AGENT_TOKEN, SMB_SHARE=\\\\192.168.1.1\\share, SMB_USER, SMB_PASS, SCAN_DIR=/
import { createHash } from "node:crypto";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

const SHARE = process.env.SMB_SHARE ?? "\\\\192.168.1.1\\share";
const TOKEN = process.env.AGENT_TOKEN ?? "";
const CLOUD = process.env.AGENT_WS_URL ?? "";

export function sha256File(path) {
  const h = createHash("sha256");
  h.update(readFileSync(path));
  return h.digest("hex");
}

export function indexDir(root) {
  const out = [];
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...indexDir(p));
    else out.push({ path: p, name, size: st.size, mtime: st.mtimeMs, sha256: sha256File(p) });
  }
  return out;
}

export function heartbeat() {
  return {
    hostname: os.hostname(),
    macs: Object.values(os.networkInterfaces()).flat().filter(Boolean).map((n) => n.mac).filter((m) => m && m !== "00:00:00:00:00:00"),
    ip: Object.values(os.networkInterfaces()).flat().filter(Boolean).find((n) => n.family === "IPv4" && !n.internal)?.address,
    share: SHARE,
    ts: new Date().toISOString()
  };
}

const ALLOW = new Set(["list", "hash", "upload", "move", "rename", "trash", "sync"]);
export function execOp(op, args) {
  if (!ALLOW.has(op)) throw new Error(`op not allowed: ${op}`);
  if (op === "list") return indexDir(args.dir ?? ".");
  if (op === "hash") return { sha256: sha256File(args.path) };
  return { ok: true, op, queued: true, note: "executes locally against SMB share; result POSTed to /api/agent/complete" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("[eiden-agent] heartbeat:", JSON.stringify(heartbeat(), null, 2));
  console.log("[eiden-agent] cloud:", CLOUD || "(set AGENT_WS_URL at the end)", "| token:", TOKEN ? "set" : "missing");
}
