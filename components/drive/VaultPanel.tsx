"use client";
import { useState } from "react";
import { Card } from "../ui/primitives";

export function VaultPanel() {
  const [unlocked, setUnlocked] = useState(false);
  const [msg, setMsg] = useState("");

  async function unlock(method: "totp" | "webauthn") {
    const r = await fetch("/api/vault/unlock", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, token: method === "totp" ? "000000" : "assertion-placeholder" })
    });
    const d = await r.json();
    setUnlocked(d.ok === true);
    setMsg(d.ok ? `Unlocked for 6h via ${method}.` : `Unlock failed: ${d.error ?? "verify 2FA"}`);
  }

  return (
    <Card label="Secrets vault (2FA · 6h session)">
      {!unlocked ? (
        <div className="mt-2 flex gap-2">
          <button onClick={() => unlock("totp")} className="min-h-[44px] px-4 rounded-2xl bg-teal-600 text-cream-50">Unlock with authenticator</button>
          <button onClick={() => unlock("webauthn")} className="min-h-[44px] px-4 rounded-2xl border">Unlock with passkey</button>
        </div>
      ) : <p className="text-sm mt-2">Vault items visible until 6h expiry. Every view is audited.</p>}
      {msg && <p className="text-xs mt-2" role="status">{msg}</p>}
    </Card>
  );
}
