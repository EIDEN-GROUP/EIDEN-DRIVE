"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, ExternalLink, Eye, EyeOff, KeyRound, Lock, Plus, RefreshCw, Search, ShieldCheck, Trash2, TriangleAlert, Wand2 } from "lucide-react";
import { Card } from "../ui/primitives";
import Modal from "../ui/Modal";
import Select from "../ui/Select";
import ConfirmDialog from "../ui/ConfirmDialog";
import { toast } from "../ui/Toast";

type Phase = "loading" | "locked" | "enroll" | "unlocked";
interface Item { id: string; label: string; username: string | null; url: string | null; hasNotes: boolean; owner: string | null; ownerName: string | null; createdBy: string | null; created_at: string; broken?: boolean }
interface Person { id: string; username: string }

const REVEAL_MS = 20_000;

function timeLeft(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}
function genPassword(len = 20): string {
  const set = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+";
  const a = new Uint32Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => set[n % set.length]).join("");
}

export function VaultPanel() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [msg, setMsg] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [expires, setExpires] = useState<string | null>(null);

  const refreshPhase = useCallback(async () => {
    const v = await fetch("/api/vault/unlock");
    if (v.ok) { const d = await v.json().catch(() => ({})); setExpires(d.expires_at ?? null); setPhase("unlocked"); return; }
    const e = await fetch("/api/vault/enroll").then((r) => r.json()).catch(() => ({ enrolled: false }));
    setPhase(e.enrolled ? "locked" : "enroll");
  }, []);
  useEffect(() => { refreshPhase(); }, [refreshPhase]);

  async function startEnroll() {
    setBusy(true); setMsg("");
    const r = await fetch("/api/vault/enroll", { method: "POST" });
    const d = await r.json();
    setBusy(false);
    if (r.ok) setSetup({ secret: d.secret, otpauth: d.otpauth }); else setMsg(d.error ?? "Couldn't start setup.");
  }
  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg("");
    const r = await fetch("/api/vault/unlock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method: "totp", token: code }) });
    const d = await r.json();
    setBusy(false);
    if (r.ok && d.ok) { setCode(""); setSetup(null); await refreshPhase(); }
    else setMsg(d.error ?? "Unlock failed.");
  }
  async function lockNow() {
    await fetch("/api/vault/unlock", { method: "DELETE" });
    setPhase("locked"); setMsg("Vault locked.");
  }

  if (phase === "unlocked") return <Unlocked expires={expires} onLock={lockNow} onLocked={() => { setPhase("locked"); setMsg("Your vault session ended — unlock it again."); }} />;

  return (
    <Card label="Secrets vault · 2FA · 6 h session">
      {phase === "loading" && <p className="text-sm text-muted" role="status">Checking vault session…</p>}
      {phase === "enroll" && !setup && (
        <div>
          <p className="text-sm text-muted">Set up an authenticator app (Google Authenticator, 1Password, Authy…) to protect the vault.</p>
          <button onClick={startEnroll} disabled={busy} className="mt-3 min-h-[44px] px-4 rounded-md bg-brand text-white text-sm font-medium disabled:opacity-50">Set up authenticator</button>
        </div>
      )}
      {phase === "enroll" && setup && (
        <div className="text-sm">
          <p>1. In your authenticator app choose <em>Enter a setup key</em> and paste:</p>
          <code className="block mt-2 p-3 rounded-md bg-tint text-brand break-all select-all text-[13px]">{setup.secret}</code>
          <a href={setup.otpauth} className="inline-block mt-2 text-[12px] text-brand underline">or open in an authenticator on this device</a>
          <p className="mt-4">2. Enter the 6-digit code it shows:</p>
          <CodeForm code={code} setCode={setCode} onSubmit={unlock} busy={busy} />
        </div>
      )}
      {phase === "locked" && (
        <div>
          <p className="text-sm text-muted flex items-center gap-2"><Lock size={16} /> The vault is locked. Enter the 6-digit code from your authenticator app.</p>
          <CodeForm code={code} setCode={setCode} onSubmit={unlock} busy={busy} />
        </div>
      )}
      {msg && <p className="text-xs mt-3 text-ink/80" role="status">{msg}</p>}
    </Card>
  );
}

function CodeForm({ code, setCode, onSubmit, busy }: { code: string; setCode: (s: string) => void; onSubmit: (e: React.FormEvent) => void; busy: boolean }) {
  return (
    <form onSubmit={onSubmit} className="mt-3 flex gap-2 items-end">
      <div>
        <label htmlFor="vault-code" className="sr-only">6-digit code</label>
        <input id="vault-code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} autoFocus
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000"
          className="w-36 min-h-[44px] px-3 rounded-md border border-line bg-surface tracking-[.3em] text-center text-[16px] focus:border-brand focus:outline-none" />
      </div>
      <button disabled={busy || code.length !== 6} className="min-h-[44px] px-4 rounded-md bg-brand text-white text-sm font-medium disabled:opacity-50">Unlock</button>
    </form>
  );
}

// ── Unlocked: the real vault ────────────────────────────────────────────────
function Unlocked({ expires, onLock, onLocked }: { expires: string | null; onLock: () => void; onLocked: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [err, setErr] = useState<{ text: string; unconfigured?: boolean } | null>(null);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [del, setDel] = useState<Item | null>(null);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    const r = await fetch("/api/vault/items");
    const d = await r.json().catch(() => ({}));
    if (r.status === 403 && d.locked) { onLocked(); return; }
    if (!r.ok) { setErr({ text: d.error ?? "Couldn't load the vault.", unconfigured: !!d.unconfigured }); setItems([]); return; }
    setErr(null); setItems(d.items ?? []); setCanCreate(!!d.canCreate);
  }, [onLocked]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (items ?? []).filter((i) => !n || `${i.label} ${i.username ?? ""} ${i.url ?? ""} ${i.ownerName ?? ""}`.toLowerCase().includes(n));
  }, [items, q]);

  async function remove() {
    const it = del; setDel(null);
    if (!it) return;
    const r = await fetch("/api/vault/items", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: it.id }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast({ text: d.error ?? "Couldn't delete.", tone: "err" }); return; }
    toast({ text: `“${it.label}” deleted.`, tone: "ok" });
    load();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-tint text-brand text-[12.5px] font-medium">
          <ShieldCheck size={15} /> Unlocked{expires ? ` · ${timeLeft(expires)}` : ""}
        </span>
        <span className="flex-1" />
        <div className="relative min-w-[180px] flex-1 max-w-[280px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search secrets" aria-label="Search secrets"
            className="w-full min-h-[44px] pl-9 pr-3 rounded-md border border-line bg-surface text-[13.5px] focus:border-brand focus:outline-none" />
        </div>
        <button onClick={load} aria-label="Refresh" className="size-11 grid place-items-center rounded-md border border-line hover:bg-tint"><RefreshCw size={16} /></button>
        <button onClick={onLock} className="min-h-[44px] px-3 rounded-md border border-line text-[13.5px] flex items-center gap-1.5 hover:bg-tint"><Lock size={15} /> Lock now</button>
        {canCreate && !err && (
          <button onClick={() => setCreating(true)} className="min-h-[44px] px-4 rounded-md bg-brand text-white text-[13.5px] font-medium flex items-center gap-1.5 hover:brightness-110"><Plus size={16} /> New secret</button>
        )}
      </div>

      {err?.unconfigured && (
        <div className="rounded-xl border border-warning/50 bg-warning/10 p-4 text-[13.5px] flex gap-3" role="alert">
          <TriangleAlert size={20} className="text-warning shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">The vault encryption key isn’t set on the server.</p>
            <p className="mt-1 text-muted">An admin needs to add <code className="px-1 rounded bg-tint text-brand">VAULT_KEK</code> to the server environment (32 random bytes, base64), then redeploy. Generate one with:</p>
            <code className="mt-2 block p-2.5 rounded-md bg-surface border border-line text-[12px] break-all select-all">node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;base64&apos;))&quot;</code>
            <p className="mt-2 text-muted text-[12.5px]">Keep it safe — losing it makes existing secrets unreadable. Nothing is stored unencrypted in the meantime.</p>
          </div>
        </div>
      )}
      {err && !err.unconfigured && <p className="text-sm text-danger" role="alert">{err.text}</p>}

      {items === null && !err && <div className="space-y-3" aria-label="Loading vault"><div className="skel h-20 w-full" /><div className="skel h-20 w-full" /></div>}
      {items && !err && shown.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line py-14 text-center">
          <KeyRound size={30} className="mx-auto text-muted/60" />
          <p className="mt-3 text-[15px] font-medium">{items.length === 0 ? "No secrets yet" : "No secrets match your search"}</p>
          <p className="mt-1 text-[13px] text-muted">{items.length === 0 ? (canCreate ? "Add shared logins and API keys. They are encrypted before they are stored." : "A manager can add secrets for you.") : "Try a different word."}</p>
          {items.length === 0 && canCreate && <button onClick={() => setCreating(true)} className="mt-4 min-h-[44px] px-4 rounded-md bg-brand text-white text-[13.5px] font-medium inline-flex items-center gap-1.5"><Plus size={16} /> New secret</button>}
        </div>
      )}
      <ul className="grid gap-3 lg:grid-cols-2" aria-label="Secrets">
        {shown.map((it) => <SecretCard key={it.id} item={it} canDelete={canCreate} onDelete={() => setDel(it)} />)}
      </ul>

      {creating && <NewSecret onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />}
      <ConfirmDialog open={!!del} title={`Delete “${del?.label}”?`} body="The encrypted secret is removed permanently. This can’t be undone." confirmLabel="Delete secret" onClose={() => setDel(null)} onConfirm={remove} />
    </div>
  );
}

function SecretCard({ item, canDelete, onDelete }: { item: Item; canDelete: boolean; onDelete: () => void }) {
  const [shown, setShown] = useState<{ secret: string; notes: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function fetchSecret() {
    setBusy(true);
    const r = await fetch("/api/vault/items", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { toast({ text: d.error ?? "Couldn't open this secret.", tone: "err" }); return null; }
    return d as { secret: string; notes: string | null };
  }
  async function reveal() {
    if (shown) { setShown(null); return; }
    const d = await fetchSecret();
    if (!d) return;
    setShown(d);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(null), REVEAL_MS);
  }
  async function copy() {
    const d = shown ?? (await fetchSecret());
    if (!d) return;
    try { await navigator.clipboard.writeText(d.secret); toast({ text: "Copied. Clear your clipboard when you’re done.", tone: "ok" }); }
    catch { toast({ text: "Couldn’t copy — use Reveal instead.", tone: "err" }); }
  }
  const host = (() => { try { return item.url ? new URL(item.url.startsWith("http") ? item.url : `https://${item.url}`).hostname : null; } catch { return item.url; } })();

  return (
    <li className="card p-4">
      <div className="flex items-start gap-3">
        <span className="size-10 rounded-lg bg-tint text-brand grid place-items-center shrink-0" aria-hidden="true"><KeyRound size={18} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium truncate">{item.label}</p>
          <p className="text-[13px] text-muted truncate">{item.username ?? "No username"}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[11.5px] text-muted">
            {host && <a href={item.url!.startsWith("http") ? item.url! : `https://${item.url}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">{host} <ExternalLink size={11} /></a>}
            {item.ownerName && <span>for {item.ownerName}</span>}
            <span>{new Date(item.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
          </p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={reveal} disabled={busy || item.broken} aria-label={shown ? `Hide ${item.label}` : `Reveal ${item.label}`} title={shown ? "Hide" : "Reveal (audited)"}
            className="size-11 grid place-items-center rounded-md hover:bg-tint text-ink/80 disabled:opacity-40">{shown ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          <button onClick={copy} disabled={busy || item.broken} aria-label={`Copy ${item.label}`} title="Copy secret (audited)"
            className="size-11 grid place-items-center rounded-md hover:bg-tint text-ink/80 disabled:opacity-40"><Copy size={16} /></button>
          {canDelete && <button onClick={onDelete} aria-label={`Delete ${item.label}`} title="Delete" className="size-11 grid place-items-center rounded-md hover:bg-danger/10 text-muted hover:text-danger"><Trash2 size={16} /></button>}
        </div>
      </div>
      {shown && (
        <div className="mt-3 rounded-lg bg-soft border border-line p-3 pop-in">
          <code className="block text-[14px] break-all select-all font-mono">{shown.secret}</code>
          {shown.notes && <p className="mt-2 text-[12.5px] text-muted whitespace-pre-wrap">{shown.notes}</p>}
          <p className="mt-2 text-[11px] text-muted">Hides itself in 20 seconds.</p>
        </div>
      )}
    </li>
  );
}

function NewSecret({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [d, setD] = useState({ label: "", username: "", url: "", secret: "", notes: "", owner: "" });
  const [people, setPeople] = useState<Person[]>([]);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof d, v: string) => setD((x) => ({ ...x, [k]: v }));
  const field = "w-full min-h-[44px] mt-1 rounded-md border border-line bg-surface px-3 text-[14px] focus:border-brand focus:outline-none";

  useEffect(() => {
    fetch("/api/users").then((r) => r.json().catch(() => ({}))).then((j) => setPeople(((j.results ?? []) as Person[]).map((p) => ({ id: p.id, username: p.username })))).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const body = { label: d.label.trim(), username: d.username.trim() || undefined, url: d.url.trim() || undefined, secret: d.secret, notes: d.notes.trim() || undefined, owner: d.owner || undefined };
    const r = await fetch("/api/vault/items", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error ?? "Couldn't save the secret."); return; }
    toast({ text: "Secret saved (encrypted).", tone: "ok" });
    onCreated();
  }

  return (
    <Modal open title="New secret" onClose={onClose} width={500} labelId="vault-new">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div><label htmlFor="v-label" className="text-[13px] text-muted">Name</label>
          <input id="v-label" autoFocus required maxLength={80} value={d.label} onChange={(e) => set("label", e.target.value)} className={field} placeholder="e.g. Hostinger panel" /></div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label htmlFor="v-user" className="text-[13px] text-muted">Username / email</label>
            <input id="v-user" autoComplete="off" maxLength={160} value={d.username} onChange={(e) => set("username", e.target.value)} className={field} /></div>
          <div><label htmlFor="v-url" className="text-[13px] text-muted">Website</label>
            <input id="v-url" autoComplete="off" maxLength={300} value={d.url} onChange={(e) => set("url", e.target.value)} className={field} placeholder="https://" /></div>
        </div>
        <div>
          <label htmlFor="v-secret" className="text-[13px] text-muted">Secret</label>
          <div className="flex gap-2">
            <input id="v-secret" required autoComplete="new-password" type={show ? "text" : "password"} maxLength={4000} value={d.secret} onChange={(e) => set("secret", e.target.value)} className={`${field} font-mono`} />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide secret" : "Show secret"} className="mt-1 size-11 shrink-0 grid place-items-center rounded-md border border-line hover:bg-tint">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            <button type="button" onClick={() => { set("secret", genPassword()); setShow(true); }} aria-label="Generate a strong password" title="Generate" className="mt-1 size-11 shrink-0 grid place-items-center rounded-md border border-line hover:bg-tint text-brand"><Wand2 size={16} /></button>
          </div>
        </div>
        <div><label htmlFor="v-notes" className="text-[13px] text-muted">Notes <span className="text-muted/70">(optional, encrypted too)</span></label>
          <textarea id="v-notes" rows={2} maxLength={4000} value={d.notes} onChange={(e) => set("notes", e.target.value)} className={`${field} py-2 resize-none`} /></div>
        <div>
          <span className="text-[13px] text-muted">Who can open it</span>
          <Select className="mt-1" label="Owner" value={d.owner} onChange={(v) => set("owner", v)} placeholder="Only me"
            options={[{ value: "", label: "Only me (and managers)" }, ...people.map((p) => ({ value: p.id, label: `${p.username} (and managers)` }))]} />
        </div>
        {err && <p className="text-[13px] text-danger" role="alert">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="min-h-[44px] px-4 rounded-md border border-line text-[13.5px] hover:bg-tint">Cancel</button>
          <button disabled={busy || !d.label.trim() || !d.secret} className="min-h-[44px] px-5 rounded-md bg-brand text-white text-[13.5px] font-medium disabled:opacity-50">{busy ? "Encrypting…" : "Save secret"}</button>
        </div>
      </form>
    </Modal>
  );
}
