# 04 — Calendar rebuild · Tags · Drives placement · real Vault · sidebar rail

Rule applied throughout: **nothing decorative** — every control either works or was removed.

## 1. Calendar (mirrors the supplied schedule reference)
`app/(app)/calendar/CalendarClient.tsx` + `components/calendar/*`
* **Left panel:** big month title with round ‹ › buttons; mini month (Sunday-first, selected-week row highlighted, ring on the selected day, filled circle on today, a dot under days that have plans); **agenda** grouped OVERDUE / TODAY / TOMORROW / next days with time range, title, `@ folder`, and a **Done/Undo** button; bottom bar with **New plan** and a **Files** overlay toggle.
* **Main:** large `October 2026` title, ‹ This Week › controls, segmented **Day · Week · Month · Quarter · Year** (✓ on the active one), search box (title, notes, date, priority, folder), sub-heading ("This Week" or the date range).
* **Week/Day grid:** sticky day headers (SUN + big number + plan count), hour labels both sides (right gutter only when there is room), half-hour guide lines, tinted weekend and today columns, **red current-time line**, coloured blocks (left border + tinted fill, time + ring marker), overlapping plans laid out side by side, untimed plans in an *all-day* strip. Click an empty slot → New plan at that time. Click a block → edit.
* **Month:** 6×7 grid with up to 3 chips + "+N more". **Quarter / Year:** compact month cards (click a day → Day view, a month name → Month view).
* **Colours** = priority (low orange · normal blue · high pink), matching the reference's three event colours; mixed with the surface so dark mode works.
* **Adaptations (and why):** no weather (no data source) → plan count; "Join" → **Done/Undo** (plans are tasks, not video meetings); "+" rail → "New plan" button; plans have no end time in the schema → shown as 1 h blocks.
* **Real data/actions:** `/api/plans` GET · POST · PATCH · DELETE (create, edit, delete, done), `/api/folders` (link a plan to a folder), `/api/drive` (file-activity overlay).

## 2. Tags (new, real)
* Migration **`0013_tags.sql`** — `tags`, `file_tags`, `folder_tags` (server-only access, same pattern as `plans`). API: `GET/POST/PATCH/DELETE /api/tags`, `POST /api/tags/assign`. Names unique case-insensitively; any signed-in member can create/attach; only the creator or a manager can rename/recolour/delete.
* UI (Explorer): **Tags** section in the left pane with **+**; per-tag count, hover menu (Edit / Delete); click to **filter** files *and* folders (multi-select = must have all). Attach from right-click → **Tags…**, or **Add tag** in the details panel (type a new name + Enter to create-and-attach). List view shows tag dots; grid tiles show dots; details panel shows removable chips.
* **Departments** (manager-set `folders.dept`) are kept as a separate, read-only **Departments** filter group.

## 3. Drives moved out of the main area
* The big "DRIVES" cards are gone. **Drives** is now a section in the Explorer's left pane: one row per connected account with a usage bar (amber ≥ 80 %, red ≥ 95 %), free space, status (Unreachable / Disabled), a **Manage** link to Storage. Click = browse that drive.
* The raw "Auto · drive" dropdown is gone. **Upload** is now a primary **split button**: the main part uploads, the caret chooses the destination (*Auto · most free space* or a specific active drive). The choice is remembered in the browser; down/disabled drives aren't offered.

## 4. Vault is now real
`components/drive/VaultPanel.tsx`, `app/api/vault/items`, `lib/vault.ts`
* After TOTP unlock: **list** (name, username, site, owner, date), **search**, **Reveal** (auto-hides in 20 s, audited), **Copy** (audited), **New secret** (managers/admins; generator button; choose who it belongs to), **Delete**, **Lock now**, session countdown.
* Secrets are sealed **server-side** with AES-256-GCM (`sealItem/openItem`) under `VAULT_KEK` (32 random bytes, base64, server env only). The database stores only ciphertext; lists never contain passwords. Wrong key or tampering fails authentication. Members see only their own items. Raw-blob `PUT` removed.
* If `VAULT_KEK` isn't set the page says exactly how to generate and set it instead of pretending to work.

## 5. Sidebar
* **Collapse = slim icon rail** (76 px, icon + label, tooltips) instead of vanishing; smooth width animation; choice remembered **and applied before first paint** (boot script sets `<html data-sb>`); sensible default per screen width (full ≥ 1280, rail 768–1279, drawer < 768); drawer closes on resize.
* The decorative "Eiden v0.1.0" promo card is now a **live Storage card** (total used/total, drive count, agent online/offline) from `/api/storage`; it hides if nothing is connected.
* Storage page: the claim of automatic nightly backups was replaced with what actually happens (the agent picks up queued checks on its heartbeat).

## 6. Shared components added
`ui/Select` (styled, keyboard-accessible dropdown — replaces raw `<select>`), `ui/Menu` (+ custom trigger), `tags/*`, `calendar/*`.

## Apply checklist
1. Supabase SQL: run **`0013_tags.sql`** (after 0012). Without it, tag UI stays empty and the API returns errors you can see in `/api/health`-style checks.
2. Server env: add **`VAULT_KEK`** (see `.env.example`), redeploy.
3. Hard-reload once after deploy (service worker is network-first now, so one reload is enough).

## Verified / not verified
* Type-check clean · `npm test` 36/36 (includes new vault-sealing tests) · `npm run build` passes · every screen above screenshotted in a headless browser with fake data.
* Not run against a live Supabase: tag/vault API calls, `0013`. Calendar was checked in Week/Month/Year at 1440 px; phone layout (Day view) was not screenshotted.
