# 10 — Google OAuth refresh token: click-by-click tutorial

Your setup (already correct):
* Domain: `https://drive.eiden-group.com`
* Authorized redirect URI in Google Cloud Console: `https://drive.eiden-group.com/api/auth/google/callback` — must match EXACTLY (no trailing slash).
* Login account for consent: `fileos@eiden-group.com` (must have access to the Shared Drive).

## What the other agent's quote means

Google never shows the refresh token in the Console. Your app must ask Google for it once via OAuth, Google sends back a one-time `?code=...`, your server swaps it for tokens. The two routes I added do exactly that:

* `/api/auth/google` — redirects you to Google consent (with `access_type=offline` + `prompt=consent`, which forces Google to include a refresh token even if you granted before).
* `/api/auth/google/callback` — exchanges `code` and displays the refresh token ONCE.

## Do it (5 min)

1. Deploy latest code to Vercel (`drive.eiden-group.com`) with `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `NEXT_PUBLIC_APP_URL=https://drive.eiden-group.com` set.
2. Sign in to Eiden-Drive as Admin (Oualid) — or set `APP_SETUP_KEY=<random>` in Vercel and use `?key=` (see step 3).
3. Open `https://drive.eiden-group.com/api/auth/google` (or with `?key=...` if using setup key).
4. Google consent → choose `fileos@eiden-group.com` → check the Drive access box → Allow.
5. Callback page shows a gold box with the token → Copy → Vercel → project → Settings → Environment Variables → add `GOOGLE_REFRESH_TOKEN=<paste>` (all environments) → Save → Redeploy.
6. Verify: open `/drive` — files list, no more `google-not-configured`.

## The 3 unfilled vars (your .env check)

| Var | How to fill |
|---|---|
| `GOOGLE_REFRESH_TOKEN` | Steps above. One value, ~200 chars, starts with `1//`. Never commit to git. |
| `AGENT_TOKEN` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` → paste SAME value in Vercel env AND office-PC env (`local-agent/.env`), then `node src/index.js`. |
| `VAULT_KEK_ID` | Supabase Dashboard → Vault → New secret → name `eiden-vault-kek`, value: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` → use its id/secret name here. P2 decryptor reads it server-side only. Vault unlock uses per-user TOTP (`/api/vault/enroll`), independent of this key. |

## Security notes
* The start route sets an httpOnly `eiden_oauth_state` cookie; the callback only works in the **same browser** within 10 minutes and rejects a missing/mismatched `state`.
* For the Drive push-notification webhook also set `GOOGLE_WEBHOOK_TOKEN` (random hex) and register the watch channel with the same value as its `token`.

## Troubleshooting

* `redirect_uri_mismatch` → Console URI ≠ code URI char-for-char. Copy from `lib/google-auth.ts` output: must be `https://drive.eiden-group.com/api/auth/google/callback`. Wait ~5 min after Console edits.
* `no refresh_token returned` → you approved before without `prompt=consent`. Our route already sends `prompt=consent`; if it still happens, go to `myaccount.google.com/permissions` (as fileos@) → remove "EIDEN FileOS" → retry.
* `access_denied` → you clicked Deny, or the account isn't fileos@. Retry and Allow.
* Callback `403` → sign in as Admin/Manager first, or append `?key=YOUR_APP_SETUP_KEY`.
* After filling token, `/drive` still `google-not-configured` → you forgot Redeploy (env only applies after redeploy).
