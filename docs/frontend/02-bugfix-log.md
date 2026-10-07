# 02 — Bug-fix log (full project review → fixes)

Source: the review done at the start of this pass (code + migrations read, `tsc`/tests run). Every item below was
fixed in code unless it says **NOT FIXED**. IDs match the review list.

> ## ⚠️ Apply checklist (nothing below is live until you do this)
> 1. **Run `supabase/migrations/0004_rls_hardening.sql`** in Supabase → SQL editor. Re-runnable. Without it the code fixes still work, but the database stays open to the browser's anon key (bug 1).
> 2. **Env (Vercel + local `.env`)** — names only: `SUPABASE_SERVICE_ROLE_KEY` (now **required**: audit, vault, agent, webhook, profile changes use it), `AGENT_TOKEN`, **new** `GOOGLE_WEBHOOK_TOKEN` (random hex; pass the same value as `token` when registering the Drive watch channel).
> 3. Redeploy.
> 4. Smoke test in order: sign in → `/drive` loads → trash a file (appears in Bin; audit row appears in `/activity` as manager) → `/vault` → set up authenticator → unlock with the code.
> 5. Policies were **not executed against a live database in this session** (no Supabase credentials available to me). Treat step 4 as the acceptance test; if an operation returns "row-level security" errors, the failing table/policy is the place to look.

## Critical

| # | Bug | Fix | Files |
|---|-----|-----|-------|
| 1 | RLS enabled on **one** table; every other table open to the public anon key (could set own `role`, forge `vault_auth`, read `vault_items`) | New migration: RLS on all 12 tables, `is_manager()` helper, per-table policies (own-row writes, manager moderation, server-only writes for audit/jobs/vault_auth/vault_totp/profiles), `revoke all … from anon` | `supabase/migrations/0004_rls_hardening.sql` |
| 2 | Audit log silently wrote nothing (RLS on, no INSERT policy, error swallowed) and every user could read all of it | `logAudit`/`notify` write with the service-role client; audit SELECT limited to managers + own events | `lib/audit.ts`, `lib/alerts.ts`, `lib/supabase-admin.ts` (new), migration 0004 |
| 3 | Vault unlock accepted **any** token | Real RFC 6238 TOTP (no dependency): enrol (`POST /api/vault/enroll`), verify ±1 step, 5 wrong codes → 5-min lockout, `vault_auth` written only after a valid code and only by the server; passkey path returns 501 instead of pretending | `lib/totp.ts`, `app/api/vault/{unlock,enroll}/route.ts`, `components/drive/VaultPanel.tsx`, migration 0004 (`vault_totp`) |
| 4 | Agent endpoint open when `AGENT_TOKEN` unset; with a token set, the middleware 401'd the agent anyway | `/api/agent` public in middleware; route requires bearer (constant-time compare), **fails closed (503)** if unconfigured; GET needs a manager session | `middleware.ts`, `app/api/agent/route.ts` |

## High

| # | Bug | Fix | Files |
|---|-----|-----|-------|
| 5 | Google webhook blocked by auth *and* unverified | Public in middleware; requires `X-Goog-Channel-Token == GOOGLE_WEBHOOK_TOKEN` (503 if unset), ignores the `sync` handshake, writes the job with the service role | `middleware.ts`, `app/api/drive/webhook/route.ts`, `.env.example` |
| 6 | OAuth callback public with no `state` check (anyone finishing a flow saw the refresh token) | Start route sets an httpOnly `Secure` cookie = `state`; callback refuses without a matching cookie, then clears it; response `no-store` | `app/api/auth/google/route.ts`, `…/callback/route.ts` |
| 7 | Trash hard-coded classification `"Contracts"` → every trash created an approval + alert | Reads the file's real folder classification; approval only for sensitive classes | `app/api/drive/trash/route.ts` |
| 8 | Trash not atomic (Google first, DB errors ignored) | DB first, then Google; Google failure rolls the bin row back and returns 502; every DB error is checked; restore mirrors this | `trash/route.ts`, `restore/route.ts` |
| 9 | Upload crashed: `picked` undefined | Uses the `files` parameter (now `list`) | `components/drive/Explorer.tsx` |
| 10 | A manager could edit an admin's department tag | Target looked up; admin targets editable by admins only; admins can't demote themselves; writes go through the service role after these checks (profiles has no client UPDATE policy) | `app/api/users/route.ts` |

## Medium

| # | Bug | Fix | Files |
|---|-----|-----|-------|
| 11 | Zod `.parse()` threw → **500** on bad input | `parseJson`/`parseQuery` (`safeParse`) → 400 with issues; applied to trash, restore, users, folders, upload, upload-url, download, vault | `lib/http.ts` (new) + routes |
| 12 | Routes without session / role checks | `GET /api/folders`, `GET /api/drive`, `GET /api/activity` now require a session; members can't pick an arbitrary department tag on folder create. **Partly NOT FIXED:** department-scoped *visibility* (members seeing only their department) is still not enforced — policies currently let any signed-in user read company file metadata (documented decision, needs product input) | routes, migration 0004 |
| 13 | `upload` trusted client `backends`/`storage_path`/`folder` | Zod enum for backends, uuid folder, 64-hex hash; `storage_path` must start with the caller's id and contain no `..` | `app/api/drive/upload/route.ts` |
| 14 | Vault `PUT` unvalidated | Zod (`owner` uuid, `enc_blob` ≤ 200 kB) + audit entry | `app/api/vault/unlock/route.ts` |
| 15 | `department_tag` schema made "undefined" handling meaningless | `.nullable().optional()` + "nothing to update" guard | `users/route.ts` |
| 16 | Drive-query injection via backslash | strips `\` and `'` | `lib/google-drive.ts` |
| 17 | `%`/`_` in search acted as wildcards | `escapeLike()`; query capped at 120 chars | `lib/http.ts`, `app/api/drive/route.ts` |
| 18 | `download` accepted any string id | uuid-validated, `maybeSingle()`; (visibility caveat as #12) | `app/api/drive/download/route.ts` |
| 19 | Any path containing "." skipped auth (`/api/x.json`) | Only real static extensions bypass, and never under `/api/` — verified: `/api/drive.json` → 401 | `middleware.ts` |

## Low / frontend / tooling

| # | Bug | Fix |
|---|-----|-----|
| 20 | `tsc` errors (no `target`) | `"target": "es2017"` in `tsconfig.json`; stale incremental cache cleared. `tsc --noEmit` = **0 errors** |
| 21 | Mobile bottom nav: every tab pointed to `/drive` | Removed with the old layout; replaced by the drawer sidebar (real links) |
| 22 | Sidebar/nav shown on the login page | Pages moved into the `(app)` route group; login has no shell |
| 23 | Hydration warning (service-worker `<script>` in `<body>`, extensions editing `<html>/<body>`, theme attribute) | Boot script moved to `<head>`, `suppressHydrationWarning` on `<html>`/`<body>`; no render-time `Date`/`window` reads remain |
| 24 | `npm audit` | **NOT FIXED**, see below |
| 25 | Doc/code mismatches | Corrected (below) |
| 26 | **Found while fixing:** Vitest alias `@` pointed one directory too high | `vitest.config.mts` now resolves to the project root; `server-only` stubbed for unit tests |

### #24 npm audit (NOT FIXED — needs a decision)
`npm audit` reports 13 (1 critical, 6 high). The production-relevant ones are all **Next.js 14.2.35** advisories (image optimizer DoS, RSC deserialisation DoS, rewrite smuggling) plus transitive `postcss`/`uuid`. 14.2.35 is the last 14.x line; the fix is a **major** upgrade (Next 15/16 + React 19), which touches `@supabase/auth-helpers-nextjs` and the API route signatures. Not run automatically because `npm audit fix --force` would break the build. Mitigations today: the app does not use `next/image` remote patterns or rewrites. Plan the upgrade as its own task.

## Tests added / status
* `tests/unit/totp.test.ts` — RFC 4226/6238 vectors, ±1 step drift, malformed tokens, secret/URI shape.
* `tests/unit/http.test.ts` — 400-not-500 parsing, LIKE escaping, constant-time compare.
* Results in this session: `npm test` **23/23**; `npm run test:live` against the local dev server **14/14**; `tsc --noEmit` **0 errors**; `npm run build` **passes**.
* Not run: anything needing a live Supabase (RLS policies, TOTP enrolment end to end, real uploads), Vercel deploy, prod live-suite.

## Known remaining gaps (unchanged, tracked in `docs/11`)
Passkey/WebAuthn unlock (returns 501), dual-approval permanent delete, rate limiting on auth/OTP, department-scoped visibility (#12), agent `complete` route, MCP transport, TOTP secrets stored unencrypted at rest in `vault_totp` (server-only table; encrypt with the vault KEK in P2), Storage-bucket policies (`eiden-uploads`) not in migrations.

## Documentation corrections made
* `docs/05` — "signed URLs 15 min" → downloads 5 min; vault now really verifies TOTP.
* `docs/07` — agent route is `/api/agent` (POST heartbeat/jobs with bearer, GET manager list); no `/agent/jobs`.
* `docs/10` — callback is protected by the OAuth `state` cookie, not by removing `APP_SETUP_KEY`; "stub-accept mode" removed; `GOOGLE_WEBHOOK_TOKEN` added to the env list.
* `docs/00-index.md` and `docs/11-project-journal.md` — link to this folder / new rows.

## Added after first run
| # | Bug | Fix |
|---|-----|-----|
| 27 | `public/sw.js` was **cache-first for everything** (pages, CSS, JS): after any deploy — or locally — browsers kept showing the previous UI | v2 is network-first (cache is offline fallback only), skips `/api/` and `/_next/`, deletes old caches on activate; on `localhost` the boot script unregisters service workers and clears caches. **Users with the v1 worker need one hard reload** (⌘⇧R) or two normal reloads. |
| 28 | `manifest.json` / metadata referenced icons that did not exist (404) and the old name | New icon set generated; manifest rewritten (see `01-redesign.md` §6) |
| 29 | **"Hydration failed…" in the browser on `/login`** (clean browser: no error). Reproduced with a simulated password-manager extension that adds an icon/attributes next to `<input type=email>` before React hydrates → identical error + "Switched to client rendering" | Login form fields render only after mount (server HTML keeps heading + sized placeholder); `/drive` Explorer is a client-only dynamic import (`components/drive/ExplorerClient.tsx`) so its search field can't mismatch either. Re-run with the simulation: no errors; form still renders (label, 44 px input, Google button). Tests adjusted: SSR-HTML assertions on form fields removed (live suite now 13 tests, was 14 — two merged). Dev overlay only; production recovers silently, this just removes the noise. |
| 30 | **Upload failed in production: "new row violates row-level security policy"** (red toast on `/drive`). Storage links were minted with the user's JWT, and the private `eiden-uploads` bucket has no per-user policies. Folder creation worked because it already used the service role. | `lib/storage.ts`: `signedUploadUrl` and new `signedDownloadUrl` use the service-role client; `/api/drive/download` uses it. Auth + `<user id>/…` path rule are enforced in the routes first. Regression test `tests/unit/storage.test.ts`. **Needs deploy.** Also required in Supabase: bucket `eiden-uploads` (private) and migration `0003` (`file_index.storage_path`). `GET /api/health` reports both. |
| 31 | Sidebar collapse made the whole sidebar disappear (no nav, content jump), tablets had no sidebar, saved state applied after paint (flash) | Slim icon rail + animation + pre-paint boot attribute + width-based defaults (see doc 04 §5) |
| 32 | Vault unlocked into an empty shell (no way to create/view secrets); raw `PUT` accepted arbitrary blobs | Real encrypted items API + UI; raw PUT removed (doc 04 §4) |
| 33 | Tags couldn't be created or assigned; Tags pane only echoed department names | Real tag system (migration 0013 + API + UI) (doc 04 §2) |
| 34 | Raw browser `<select>` for upload target and oversized drive cards in the file area | Upload split button + Drives section in the pane (doc 04 §3) |
| 35 | Decorative sidebar promo and an inaccurate "automatic backups" claim | Live storage card; honest backup wording (doc 04 §5) |
| 36 | Viewer dead ends: Word/Excel/PowerPoint/CSV/archives/fonts/unknown files only offered "download to view"; PDFs relied on the browser frame | Universal reader (doc 05) |
| 37 | Markdown preview allowed attribute injection via a crafted link (`"` was not escaped) → script execution in the app's origin | Quotes escaped in the legacy renderer; new Markdown/Word/notebook/EPUB output goes through DOMPurify; regression tests |
| 38 | `/api/drive/download?raw=1` served uploader-declared MIME types inline with no sniffing protection | `nosniff`, `no-store`; HTML/SVG/XML/JS forced to download + CSP sandbox |
| 39 | Opening a document with a remote `<img>` could ping an external tracker | Remote images removed by the sanitiser (embedded pictures only) |
| 40 | Production build failed with pdf.js (`canvas.node`) | `canvas: false` alias in `next.config.mjs` |
