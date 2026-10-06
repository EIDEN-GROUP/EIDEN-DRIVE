# EIDEN-DRIVE — Project Journal (master record)

> One file that explains everything: what was asked, what was decided, what was built,
> how to run it, and what is left. **Contains zero secrets** — env var *names* only.
> Values live in `.env` (local, git-ignored) and Vercel env. Never paste values here.

## 0. Conversation log (every request → outcome)

| # | User asked | Outcome |
|---|-----------|---------|
| 1 | New project `Eiden-drive`: local drive for Eiden-Group; sync Google Drive + router USB; good UI/UX web-app, responsive; track every member move (username, IP, MAC, browser, system); AI agent adds/views private-only files (no edit/delete); members view/edit/add/delete-to-trash (never permanent); view/edit pdf/docx/etc; folders, filters; fully secured; encrypted accounts vault + 2FA (all kinds) with 6 h re-auth; only managers/admin create accounts; offline mode; logo later; colors from MD; alerts (storage full…); notifications; per-member department tags (manager-only). Pasted a previous agent's FileOS plan + dept notes (Hassan brand-book/posts/video; Abdelhakim planning/web/landing/systems; Aya manual; Oualid overview; roles Admin-everything / Managers-everything / members trash-only). | Plan v1 delivered (plan mode): FileOS architecture, roles matrix, safe-delete, audit, vault, PWA. Locked: Next.js + Supabase Cloud + Vercel; Shared Drives primary; TOTP+WebAuthn; per-member AI space via MCP. |
| 2 | "good do it… docs in /docs, readme, use any skills you need" | Scaffold built (37 files): app routes, lib, Supabase schema `0001`, local-agent stub, MCP stub, docs 00–09, README. Skill `ui-ux-pro-max` loaded for design direction. |
| 3 | "just do the other stuff and finish everything, .env at the end" | Full implementation: lib (roles/audit/google/vault/alerts/files/offline), components, all pages + APIs, agent + MCP policy, PWA SW, migration `0002`. |
| 4 | Logo image attached; domain `https://drive.eiden-group.com`; redirect URI `…/api/auth/google/callback`; quoted refresh-token flow ("open /api/auth/google → consent as fileos@ → callback shows token"); "i did fill everything go check, for those [I] didnt fill i dont know how give me a tetur" | Checked `.env` masked (names only): everything set except `GOOGLE_REFRESH_TOKEN`, `AGENT_TOKEN`, `VAULT_KEK_ID`. Built the two OAuth routes + `lib/google-auth.ts` + tutorial `docs/10`. Logo wired as `/logo.png` w/ SVG fallback (user to drop PNG). |
| 5 | "push everything on github.com/EIDEN-GROUP/EIDEN-DRIVE.git branch main, i did the other stuff except the refresh-token" | `.gitignore` hardened (`.env` ignored), committed, pushed `main` (`472258c`). |
| 6 | Vercel build error (webpack: spread syntax in `app/api/drive/route.ts`) | Fixed syntax + follow-ons found by local `npm run build`: Google SDK nullable types, `createServerComponentClient` (helpers@0.10), `force-dynamic` on all cookie routes + root layout, viewport export, Next 14.2.5→14.2.35 (security). Pushed `4a3abf4`, build green. |
| 7 | Live `GET / 500` Server Components error; "check deployment, use vercel command, check the webapp, domain on Hostinger" | Root cause: `onError` handler inside server-component layout → whole render crashed. Fix: client `Logo.tsx` owns PNG→SVG fallback. Pushed `b818d7d`. Vercel CLI unavailable headless (needs login); verified via curl: `/ /drive /login /activity /api/drive` all 200. Hostinger DNS+TLS confirmed working. |
| 8 | "fix all UI-UX/design, fix login requirement, fix all logic production-grade, md file explaining everything incl. our convo (no env, only env.example) in /docs, everything working, fix logo — use just that logo as local file, end-to-end + UI + UX + API tests in /test folder, doc everything, use skills/MCPs; drive = Windows-folder design (sites like …)" + "use all mcps skills and continue" | This build: recreated monogram as `public/logo.png` (PIL, verified visually); `middleware.ts` auth wall; real Supabase login (magic link + Google SSO) + `/api/auth/callback`; Windows-explorer Drive (tree/toolbar/breadcrumb/grid+list/details/status bar); real uploads via signed Supabase Storage URLs + `/api/drive/download`; folders API; Recovery Bin page; toasts + confirm dialogs; SVG icon set; error/loading/404 boundaries; Vitest suites (`tests/`: 14 unit + 14 live); this journal. MCPs: none connected in this environment (resource list empty) — MCP touchpoints documented in §7. |
| 9 | "re analyze and do deep dive on code base and what changed and make an design.md" (plan) → "do it dont commit/push" (build) → "just commit/push" → "check the login page… admin cant see alot of stuff and there permestion" | Deep dive: commit `00abc64` re-themed everything (violet system). Wrote `docs/design.md` (canonical), synced MASTER.md, superseded `docs/06`; restyled OAuth callback page to violet (last old-palette instance). Users: manager+ see emails/join/last-active (service role, server-side), new `GET /api/users` (manager+), `DELETE /api/users` (admin, self/last-admin guards), `MemberRow` row editing (role admin-only, dept manager+, remove admin-only) + extended contract tests. Login verified complete (invite-only error, Google SSO, welcome flow). |
| 10 | "check the login logic and other stuff… fix calendar and login rate limit… CRUD (create/edit/delete)… member add + role checker… drive pulls all data from Google" | Login: 60 s resend cooldown (localStorage) + 429/rate-limit mapped to a plain message; double-submit already blocked. CRUD: `PATCH /api/folders` rename (members+), `DELETE /api/folders` (manager+, empty-only), `PATCH /api/drive/rename` (members+, Google+index, audited); Explorer rename dialog, folder delete confirm, "Sync from Google" menu item. Calendar/schedule: Storage page is now live (real Drive quota, agent heartbeat, jobs feed) + "Run backup check now" (manager+, queued job + audit). Drive sync: `POST /api/drive/sync` (manager+, paginated full pull, upsert by `google_file_id`). Members/roles: invite flow + PATCH guards + directory re-verified; contract tests extended (13 live). Verified: tsc 0, build 12/12, unit 28/28, live 13/13. |
| 11 | "custom auth email/password, fully secured, data in Supabase; fix 'Ask a manager to invite you' with name/email/message form; login asks OTP or password" | Login is now 3-step: email → choose **Email link** or **Password** → subform (+ Google + resend cooldown kept). Passwords via Supabase Auth (`signInWithPassword` / `updateUser`), errors mapped, show/hide toggle, min-8 client check. "Request access" form (name/email/message optional) → `POST /api/access-requests` → `access_requests` table (migration `0006`, anon-insert/manager-read RLS) + manager notifications, dup-proof, no account enumeration. Invited users set a password under account menu → **Set password** (`/account/password`). Verified: tsc 0, unit 28/28, live 14/14. Supabase-side: Auth → Password protection recommended ON; rate limits raisable under Auth → Rate limits. |

## 1. What Eiden-Drive is

Company FileOS: one responsive web app over **Google Shared Drives (primary cloud)** + **router-USB staging via an outbound-only Local Agent**. Users see one drive; admins see where bytes live (☁ Google · 💾 Local · 🛡 Backup). Safe-delete (90-day Recovery Bin, members never permanent), full audit (user·IP·browser/OS·device; MAC via agent on LAN — browsers cannot read MAC), encrypted accounts Vault (TOTP/WebAuthn, 6 h re-auth), per-member AI space via MCP (add+view only), offline PWA queue, storage/security alerts.

## 2. People, roles, departments

| Who | Role | Scope |
|-----|------|-------|
| Oualid | admin | everything, all-departments overview |
| Managers | manager | everything except demoting admins / changing roles |
| Hassan team | member | `06_PROJECTS`: brand-book, Posts-design, Video-editor |
| Abdelhakim team | member | Planning, Web-app, Website, Landing-page, System+website, System+landing(Main), System(App) |
| Aya | member(+mgr TBD) | manual per-department adds |
| Members | member | view/add/edit/move + trash-only; restore/perm-delete = manager+; sensitive folders (Finance/Legal/Contracts/HR) need approval |

Department tags: manager-only (`PATCH /api/users`). Vault items: manager/admin create, members view own after 2FA.

## 3. Architecture

```
browser (PWA, offline queue) ──HTTPS──▶ Vercel Next.js ──▶ Supabase (Postgres/Auth/Realtime/Storage/Vault)
        │                                        │                     ▲
        │                                        ▼                     │ poll jobs
        │                                  Google Drive API     Local Agent (office PC ─SMB─▶ \\192.168.1.1\share)
        │                                  Shared Drives              outbound WSS only, allowlisted ops
        └────────── AI via MCP (drive.list/read/upload, owner-scoped) ┘
```

Key decisions: USB never on the internet; Shared Drive = cloud source of truth; USB = ingest/staging (`drop → agent hash/index → Upload to Google`); Changes API + webhook (no polling); RLS + service-role server writes; audit append-only.

## 4. Design system (skill: ui-ux-pro-max)

Shell `e-green-900 #122620`, content `cream-50 #FEFFF8`, actions `teal-600 #0C5752`, gold `#CFC292` accents; functional blue `#0d6efd`, success/warning/error from `Design.md`. Fonts Anton (display) + Inter (body) + Besley italic (empty-states). Radius `2xl:1rem` cards, `full` pills. Rules enforced: 44 px targets, visible focus, labels on inputs, `aria-selected/sort/live`, SVG-only icons, reduced-motion respected, breadcrumbs on 3+ levels, confirm-before-destroy, toast every async result. Drive mirrors Windows Explorer: tree + toolbar + breadcrumb + grid/list + details + status bar.

## 5. File map

```
app/(auth)/login  app/drive  app/drive/[id]  app/activity|security|vault|users|storage
app/api/drive(+trash/restore/upload/upload-url/download/bin/webhook)  app/api/activity|agent|folders|notifications|storage|users|vault/unlock  app/api/auth/google(+callback)+callback
components/drive/Explorer  components/ui/{Logo,Toast,ConfirmDialog,SignOutButton,icons,primitives}
lib/{roles,audit,google-drive,google-auth,vault,alerts,files,offline,storage,supabase-server,supabase-client}
supabase/migrations/0001_init 0002_ai_vault 0003_uploads
local-agent/  mcp-server/  public/{logo.png,logo.svg,manifest.json,sw.js}
tests/{unit,api,e2e,ui,ux}  docs/00–11  design-system/Eiden-Drive/MASTER.md
middleware.ts  vitest.config.mts
```

## 6. Env reference (NAMES ONLY — set in Vercel + local `.env`, never commit)

Supabase: `NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PROJECT_ID`.
Google: `GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN` (via `/api/auth/google` flow, `docs/10`), `GOOGLE_SHARED_DRIVE_ID`, `GOOGLE_REDIRECT_URI=https://drive.eiden-group.com/api/auth/google/callback`, `NEXT_PUBLIC_APP_URL=https://drive.eiden-group.com`, `GOOGLE_WEBHOOK_URL`. Setup gate: `APP_SETUP_KEY` (delete after token obtained).
Agent: `AGENT_TOKEN` (random hex, same value Vercel + office PC), `AGENT_WS_URL=wss://drive.eiden-group.com/api/agent`. Vault: `VAULT_KEK_ID` (Supabase Vault secret `eiden-vault-kek`, 32-byte base64).
See `.env.example` — the only env file in git.

## 7. MCPs & skills used

* Skill `ui-ux-pro-max` (local): design-system query (Flat dense dashboard), §1–§9 rules applied to Explorer/login (a11y, touch, motion, nav, forms).
* MCP servers: **none connected** in this environment (`list_mcp_resources` empty). Integration points ready: `mcp-server/` tool contracts (`drive.list/read/upload`, `assertAIAllowed`, `x-ai-user` header) for Claude/Opencode hosts — wire transport (stdio/SSE) when an MCP host is available.
* Vercel CLI: not usable headless (needs interactive login) — deployment verified via `curl` status checks instead.

## 8. Operations runbooks

* Deploy: push `main` → Vercel builds (`npm run build` must pass; `force-dynamic` everywhere; no event handlers in server components).
* Refresh token: `/api/auth/google` as admin → consent `fileos@eiden-group.com` → paste into Vercel `GOOGLE_REFRESH_TOKEN` → Redeploy → `/drive` lists files.
* Storage bucket: Supabase → Storage → New private bucket `eiden-uploads` → apply `0003_uploads.sql` (see `tests` note if uploads 400).
* Agent: mount `\\192.168.1.1\share` on office PC → set `AGENT_TOKEN/AGENT_WS_URL/SMB_SHARE` → `node src/index.js` (Task Scheduler/systemd loop).
* Vault: create secret `eiden-vault-kek` in Supabase Vault → set `VAULT_KEK_ID` → enroll TOTP/WebAuthn per user (P2 verification wiring in `app/api/vault/unlock`).

## 9. Test log

* `npm test` — 28/28 unit pass, 7 files (files, alerts, roles, vault, totp, http, invite).
* `EIDEN_BASE_URL=http://127.0.0.1:3000 npm run test:live` — 13/13 pass (api contracts, e2e smoke, UI render).
* `EIDEN_BASE_URL=https://drive.eiden-group.com npm run test:live` — 8/14 pre-deploy (expected: auth wall + new routes not yet deployed); rerun after push → all green required before sign-off.
* UX checklist `tests/ux/checklist.md` — run manually on staging/prod, record here.
* Known quirk: `process.env.BASE_URL` is clobbered to `"/"` inside Vitest workers — suite uses `EIDEN_BASE_URL`.

## 10. Left / next (P2+)

Real TOTP/WebAuthn verification in unlock route; Google Docs/OnlyOffice in-place edit; PDF/DOCX text extraction for search; Drive→local scheduled mirror + integrity monitor; push notifications; second-admin dual approval UI; UX checklist sign-off row above.

## 11. Pass 3 — frontend redesign + bug-fix sweep (2026-10-06)

| # | User asked | Outcome |
|---|-----------|---------|
| 9 | "update the full frontend design UI/UX, mirror the image exactly (dashboard + login), no generic design; use any library; tell me first if Next.js" | Stayed on Next.js 14 + Tailwind; added `lucide-react`. New tokens, shell, Explorer (list/grid/details/context menu/tags/history), sign-in split card, dark mode. See `docs/frontend/01-redesign.md`. |
| 10 | "review the project, list the bugs" → "auto-fix any bug you found" | 26 items fixed (RLS migration 0004, audit writes, real TOTP vault, agent/webhook auth, OAuth state, validation 400s, atomic trash, …). `docs/frontend/02-bugfix-log.md` — **apply checklist at the top** (run migration 0004, set `GOOGLE_WEBHOOK_TOKEN`, redeploy). |
| 11 | "put all md files into docs/frontend/" | New docs live in `docs/frontend/`; older docs 00–11 untouched except factual corrections. |

Test log: `npm test` 23/23 · live (local) 14/14 · `tsc` 0 errors · `npm run build` passes (2026-10-06). Not run: live-Supabase RLS/TOTP end-to-end, prod deploy.

**Pass 3b —** "how do I see the admin role? / build the invite form and add the profile trigger" Migration `0005` (auto profile, always member), `POST /api/users/invite`, Invite member form on `/users`, `/welcome` landing, sign-up closed (`shouldCreateUser:false`). See `docs/frontend/03-invites-and-profiles.md` — **Supabase dashboard steps required**.
