"use client";
import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Card } from "../ui/primitives";

type Phase = "loading" | "locked" | "enroll" | "unlocked";

export function VaultPanel() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [msg, setMsg] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const v = await fetch("/api/vault/unlock");
      if (v.ok) { setPhase("unlocked"); return; }
      const e = await fetch("/api/vault/enroll").then((r) => r.json()).catch(() => ({ enrolled: false }));
      setPhase(e.enrolled ? "locked" : "enroll");
    })();
  }, []);

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
    if (r.ok && d.ok) { setPhase("unlocked"); setCode(""); setMsg(`Unlocked for ${d.valid_hours} h.`); }
    else setMsg(d.error ?? "Unlock failed.");
  }

  return (
    <Card label="Secrets vault · 2FA · 6 h session">
      {phase === "loading" && <p className="text-sm text-muted" role="status">Checking vault session…</p>}

      {phase === "unlocked" && (
        <p className="text-sm flex items-center gap-2"><ShieldCheck size={18} className="text-brand" /> Vault is open for up to 6 hours. Every view is audited.</p>
      )}

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
          <UnlockForm code={code} setCode={setCode} onSubmit={unlock} busy={busy} />
        </div>
      )}

      {phase === "locked" && (
        <div>
          <p className="text-sm text-muted flex items-center gap-2"><KeyRound size={16} /> Enter the 6-digit code from your authenticator app.</p>
          <UnlockForm code={code} setCode={setCode} onSubmit={unlock} busy={busy} />
        </div>
      )}

      {msg && <p className="text-xs mt-3 text-ink/80" role="status">{msg}</p>}
    </Card>
  );
}

function UnlockForm({ code, setCode, onSubmit, busy }: { code: string; setCode: (s: string) => void; onSubmit: (e: React.FormEvent) => void; busy: boolean }) {
  return (
    <form onSubmit={onSubmit} className="mt-3 flex gap-2 items-end">
      <div>
        <label htmlFor="vault-code" className="sr-only">6-digit code</label>
        <input id="vault-code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000"
          className="w-36 min-h-[44px] px-3 rounded-md border border-line bg-surface tracking-[.3em] text-center text-[16px] focus:border-brand focus:outline-none" />
      </div>
      <button disabled={busy || code.length !== 6} className="min-h-[44px] px-4 rounded-md bg-brand text-white text-sm font-medium disabled:opacity-50">Unlock</button>
    </form>
  );
}
