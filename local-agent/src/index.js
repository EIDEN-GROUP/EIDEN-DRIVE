// EIDEN Local Agent — outbound-only. Runs on office PC with SMB access to router USB.
// Allowlisted ops only: list/hash/upload/move/rename/trash/sync. No inbound ports, no SMB exposed.
// Env (left for the end): AGENT_WS_URL, AGENT_TOKEN, SMB_SHARE=\\\\192.168.1.1\\share, SMB_USER, SMB_PASS, SCAN_DIR=/
import { createHash } from "node:crypto";
import { readdirSync, statSync, readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
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
  if (process.argv[2] === "poll") {
    pollLoop().catch((e) => { console.error("[eiden-agent] poll crashed:", e.message); process.exit(1); });
  } else {
    console.log("[eiden-agent] heartbeat:", JSON.stringify(heartbeat(), null, 2));
    console.log("[eiden-agent] cloud:", CLOUD || "(set AGENT_WS_URL at the end)", "| token:", TOKEN ? "set" : "missing");
    console.log("[eiden-agent] usage: node src/index.js poll   (heartbeat + usb-upload jobs every 60s)");
  }
}

// Poll loop: heartbeat → pull pending jobs → execute usb-uploads → report back.
// Every HTTP call is bounded (30s) so a stalled cloud can't wedge the loop.
async function api(path, body) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 30_000);
  try {
    const r = await fetch(`${CLOUD}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body ?? {}),
      signal: c.signal
    });
    if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
    return r.json();
  } finally {
    clearTimeout(t);
  }
}

async function runUsbUpload(job) {
  const p = job.payload ?? {};
  if (!p.url || !p.name) throw new Error("job is missing its download url");
  const destDir = join(SHARE, "eiden");
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  // Dest filename is prefixed with the job id: two members uploading
  // "report.pdf" must never overwrite each other on the share.
  const dest = join(destDir, `${job.id}-${basename(String(p.name)).replace(/[^a-zA-Z0-9._-]/g, "_")}`);
  const dl = await fetch(p.url, { signal: AbortSignal.timeout(120_000) });
  if (!dl.ok) throw new Error(`bytes download -> HTTP ${dl.status}`);
  const buf = Buffer.from(await dl.arrayBuffer());
  writeFileSync(dest, buf);
  return { dest, bytes: buf.length };
}

async function once() {
  if (!CLOUD || !TOKEN) throw new Error("set AGENT_WS_URL and AGENT_TOKEN first (see README)");
  const hb = heartbeat();
  const { jobs } = await api("/api/agent", { hostname: hb.hostname });
  console.log(`[eiden-agent] heartbeat ok (${hb.hostname}), ${jobs.length} pending job(s)`);
  for (const job of jobs) {
    if (job.kind !== "usb-upload") continue; // unknown kinds stay pending for a newer agent
    try {
      const { dest, bytes } = await runUsbUpload(job);
      await api("/api/agent/complete", { job_id: job.id, ok: true, bytes });
      console.log(`[eiden-agent] usb-upload done: ${dest} (${bytes} bytes)`);
    } catch (e) {
      await api("/api/agent/complete", { job_id: job.id, ok: false, error: e.message }).catch(() => {});
      console.error(`[eiden-agent] usb-upload failed (${job.id}):`, e.message);
    }
  }
}

export async function pollLoop() {
  for (;;) {
    await once().catch((e) => console.error("[eiden-agent]", e.message));
    await new Promise((r) => setTimeout(r, 60_000));
  }
}
