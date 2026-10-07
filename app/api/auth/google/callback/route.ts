export const dynamic = "force-dynamic";

// Step 2: Google redirects here with ?code=... — we exchange it for tokens,
// identify the Gmail, and store/refresh the account in drive_accounts.
// Nothing to paste into env: the account is live immediately.
import { GOOGLE_REDIRECT_URI } from "@/lib/google-auth";
import { logAudit } from "@/lib/audit";
import { getProfile } from "@/lib/roles";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { bustAccountCache } from "@/lib/drive-accounts";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (err) return new Response(`Google refused: ${err}. See docs/10-google-oauth-refresh-token.md § troubleshooting.`, { status: 400 });
  if (!code) return new Response("Missing ?code= — open /api/auth/google first.", { status: 400 });

  // CSRF / unauthorised-callback guard: only the browser that started the flow (cookie set by the gated start route) may finish it.
  const cookieState = /(?:^|;\s*)eiden_oauth_state=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
  const urlState = url.searchParams.get("state");
  if (!cookieState || !urlState || cookieState !== urlState) {
    return new Response("Invalid or expired OAuth state. Start again from /api/auth/google (sign in as Admin/Manager).", { status: 400 });
  }
  let label = "drive";
  try {
    const parts = urlState.split(".");
    if (parts.length > 1) label = Buffer.from(parts.slice(1).join("."), "base64url").toString("utf8").slice(0, 40) || "drive";
  } catch { /* default label */ }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: GOOGLE_REDIRECT_URI(),
      grant_type: "authorization_code"
    })
  });
  const tok = (await res.json()) as { refresh_token?: string; access_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
  if (!res.ok || !tok.refresh_token) {
    return new Response(
      `Exchange failed: ${tok.error ?? res.status} — ${tok.error_description ?? "no refresh_token returned. Re-open /api/auth/google (prompt=consent is already set) or revoke old grant at myaccount.google.com/permissions and retry."}`,
      { status: 400 }
    );
  }

  const me = await getProfile();
  if (me) await logAudit({ actor: me.id, actor_name: me.username, action: "edit", req, detail: { panel: "google-oauth", event: "refresh-token-issued" } });

  // Identify the Gmail behind this grant, then store/refresh the account row.
  // Reconnecting the same Gmail refreshes its token (fixes invalid_grant).
  let email: string | null = null;
  if (tok.access_token) {
    try {
      const ui = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", {
        headers: { authorization: `Bearer ${tok.access_token}` }
      });
      const uj = (await ui.json()) as { user?: { emailAddress?: string } };
      email = uj.user?.emailAddress ?? null;
    } catch { /* email stays null — account still stored */ }
  }
  let stored = "could not store (server misconfigured)";
  if (hasAdminClient()) {
    const db = adminClient();
    const row = { label, email, refresh_token: tok.refresh_token, status: "active" };
    if (email) {
      const { data: existing } = await db.from("drive_accounts").select("id").eq("email", email).maybeSingle();
      if (existing) {
        await db.from("drive_accounts").update(row).eq("id", (existing as { id: string }).id);
        stored = `reconnected ${email} (token refreshed)`;
      } else {
        await db.from("drive_accounts").insert(row);
        stored = `connected ${email} as "${label}"`;
      }
    } else {
      await db.from("drive_accounts").insert(row);
      stored = `connected an account as "${label}" (email unknown)`;
    }
    bustAccountCache();
  }

  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Eiden Drive — drive connected</title>
<style>body{font-family:system-ui;background:#f4f4f7;color:#2b2b36;display:grid;place-items:center;min-height:100vh;margin:0}
.card{max-width:640px;background:#fff;border:1px solid #e8e8ef;padding:28px;border-radius:16px}
.ok{color:#15803d}button{min-height:44px;padding:0 20px;border-radius:12px;background:#5b3fd0;color:#fff;border:0}</style></head><body><div class="card">
<h2 class="ok">Drive account connected ✓</h2>
<p>${stored.replace(/</g, "&lt;")}</p>
<p>No env paste, no redeploy — the account is live now. Sync from the Explorer ⋯ menu to pull its files.</p>
<p><a href="/storage"><button>Open Storage</button></a></p>
</div></body></html>`,
    { headers: {
      "content-type": "text/html",
      "cache-control": "no-store",
      "set-cookie": "eiden_oauth_state=; Path=/api/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
    } }
  );
}
