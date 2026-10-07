# 01 — Frontend redesign (reference: "File Manager" dashboard + sign-in)

Reference: the Dribbble shot supplied by the owner (4 screens: list view with context menu, grid view with
details panel, file-picker dialog, split-card sign-in). Goal: same look and feel, applied to the whole app,
on the existing Next.js 14 + Tailwind stack. **No generic template** — values below were read off the screens.

## 1. What was measured from the reference

| Aspect | Reference | Implemented as |
|--------|-----------|----------------|
| Primary colour | indigo-violet, icons slightly deeper | `--brand #5B3FD0`, `--icon #4B3BC8` (dark: `#8F7BFF`) |
| Selection / active | very light lavender | `--tint #F1EFFC` + 3 px brand bar on the left edge of the active item |
| Table header | lavender band | `--head #EEEBFA` |
| Panes | white shell, `#F9F9FC` favourites pane, hairline `#E8E8EF` borders | `--surface`, `--soft`, `--line` |
| Typeface | geometric sans (Poppins-like), rounded brand wordmark, Roboto on the Material sign-in form | `next/font`: **Poppins** (UI), **Comfortaa** (wordmark), **Roboto** (login) |
| Type scale | Name column large (~15 px), metadata columns tiny (~11 px), toolbar title 16 px | same, in `Explorer.tsx` |
| File glyphs | **filled** indigo folder / image-doc / text-doc / video-doc (not outline icons) | custom SVGs in `components/ui/Glyphs.tsx` |
| Shell | sidebar · top bar · bordered main panel · far-right icon rail | `components/shell/AppShell.tsx` |
| Login | split card, beige art panel with wordmark + wave art, underlined Material fields, violet button, "or" + secondary action | `app/(auth)/login/page.tsx` |

Dark mode is an addition (moon toggle exists in the reference's top bar): same tokens, redefined under `[data-theme="dark"]`.

## 2. Design tokens (`app/globals.css`, `tailwind.config.ts`)

CSS variables: `--canvas --surface --soft --tint --head --line --ink --muted --brand --brand-deep --icon --danger --login`.
Tailwind colours map to them (`bg-surface`, `text-muted`, `border-line`, `bg-tint`, `text-brand` …).
Legacy names (`teal-*`, `cream-*`, `gold-*`) are re-pointed at the new system so no old class renders in the old palette.
Fonts: `font-body/display` = Poppins, `font-brand` = Comfortaa, `font-material` = Roboto.
Utility classes: `.card`, `.pill`, `.page-title`, `.frow` (explorer grid), `.pop-in` (140 ms entrance; disabled by `prefers-reduced-motion`).

## 3. Structure

```
app/layout.tsx                 fonts, theme boot script, toasts, suppressHydrationWarning
app/(auth)/login/page.tsx      split-card sign-in (no shell)
app/(app)/layout.tsx           server: getProfile() → <AppShell user=…>
app/(app)/{drive,activity,security,vault,users,storage}/…   pages moved into the (app) group (URLs unchanged)
app/(app)/page.tsx             "/" → redirect("/drive")
components/shell/AppShell.tsx  sidebar, top bar, right rail, theme, mobile drawer
components/drive/Explorer.tsx  the file manager
components/drive/VaultPanel.tsx  TOTP enrol/unlock UI
components/ui/{Glyphs,Modal,Menu,ConfirmDialog,Toast,primitives,Logo}.tsx
```

### Shell (`AppShell`)
* **Sidebar** 248 px: logo + wordmark, divider, "Pinned" row, nav (Drive, Activity, Security, Vault, Users, Storage), promo card ("Dismiss"/"Open", remembered in `localStorage`), Sign out. Active item = lavender fill + brand text + left bar.
* **Top bar** 72 px: hamburger (collapses sidebar on desktop / opens drawer on mobile, state remembered), divider, page title; right: avatar menu (name, role, department, sign out), theme toggle, rail toggle `»`.
* **Right rail** (≥ lg): Activity, Security approvals, Backups — real links.
* Mobile: sidebar becomes an overlay drawer; rail hidden.

### Explorer (`Explorer.tsx`)
* **Favorites** pane: Recent, Documents, Recovery Bin (count), Root. **Tags** pane: department tags from folders, each with a colour dot; click = filter.
* **Toolbar**: pane toggle · back / forward (real history stack) · current folder title · search · list/grid toggle · sort menu · "…" menu (Upload file, New folder, Refresh).
* **Breadcrumb**: `Root › Folder › …`, clickable.
* **List view**: sticky lavender header, sortable columns (Name, Tags, Location, Modified, Size, Kind), expandable folder rows (indented, keyboard ← →), selected row = lavender + brand text.
* **Grid view**: 112 px tiles with 52 px glyphs; selecting opens the **details panel** (preview, name/kind/size, key-value rows, tag chip, action icons). On < lg it is a bottom sheet.
* **Context menu** (right-click): Open, Get Info, Download, Copy link, Delete (→ confirm → Recovery Bin), tag dots.
* **Recovery Bin** view: restore per row (managers; the API enforces it).
* Dialogs (`Modal`) use the reference's header-row + × pattern: *New folder*, *Move to Recovery Bin?*.
* Accessibility kept: `role="grid"/row/columnheader`, `aria-sort`, `aria-selected`, `aria-expanded`, labelled controls, visible focus ring, 44 px targets on primary controls, Escape closes menus/dialogs.

### Sign-in (`login/page.tsx`)
Split card (`rounded-[32px]`, art panel `rounded-[22px]`, `#E6D7D4`), logo tile, "Eiden / Your files, one drive." in Comfortaa, inline-SVG wave art (red/orange/gold ribbons). Right: "Sign In Account", Material underline field (label above, 2 px violet underline on focus), full-width violet **SIGN IN** button, "or", **Continue with Google**, helper line. Art panel hidden < lg (logo tile shown above the form instead).

## 4. Deliberate deviations from the reference (and why)

| Reference element | Here | Reason |
|-------------|------|--------|
| Dashboard / Goods / Customer / Task nav | Drive, Activity, Security, Vault, Users, Storage | those are this product's real pages; no dead links |
| "Language" dropdown | removed | app is English-only; a non-working control is worse than none |
| Orange logo tile | Eiden logo on an orange tile (login) / bare logo (sidebar) | brand |
| Created column | **Location** column (☁ Google · 💾 Local · 🛡 Backup) | `file_index` has no created-at column; location is the information admins need |
| Last opened / Dimensions / Resolution | Modified / Location / Owner / SHA-256 | only real data is shown |
| Rename / Duplicate / Share in context menu | Download / Copy link | no such API exists yet; no fake actions |
| Domain + Password + Remember me + Forgot password + "default workspace" | single email field (magic link) + Google | auth is passwordless; accounts are created by managers (so "Sign up" became "Ask a manager to invite you") |
| File-picker dialog screen | not built | no feature uses it; the `Modal` component provides the same chrome for existing dialogs |
| Wave illustration | re-drawn as inline SVG | the original artwork isn't available; shapes/colours approximated |
| Dark mode | added | present in the reference top bar (moon) |

## 5. Not verified
* No visual (screenshot) comparison was run against the reference; dimensions were derived from the images by measurement/estimation. Expect small spacing differences — adjust the tokens above rather than the components.
* Logged-in screens need Supabase env + data; the login page, build, type-check and unit/live tests were run (see `02-bugfix-log.md`).

## 6. Brand: logo + name (current)
* **Name:** **Eiden Drive** (page title, sidebar, login, manifest, logo alt text, authenticator issuer, error pages).
* **Logo:** the supplied hand-drawn artwork — three stacked sheets forming an "E" (notch on the top sheet) with the chunky "Eiden / Drive" lettering — **traced into real vector paths** (no raster in the app).
  * `public/logo.svg` / `logo-dark.svg` — the mark in ink `#533FAF` / light violet `#A99BFF`; `Logo` renders both and CSS swaps them by theme (no flash, no JS).
  * `public/logo-full.svg` — the official lockup (mark + lettering), used on the sign-in art panel.
  * `public/favicon.svg` (adapts to the OS dark mode), `favicon.ico` (16/32/48), `icons/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `maskable-512.png` (mark on a soft lavender tile), `manifest.json` (name/short_name "Eiden Drive", theme `#533FAF`).
* **Sidebar:** mark + stacked "Eiden / Drive" in **Fredoka** (the rounded display face that matches the lettering; replaces Comfortaa); collapsed rail shows the mark only.
* The previous "E on a violet tile" kit (`public/logo/*`, old `icons/*`, favicons, PNG logos) was **deleted** — nothing references it.

