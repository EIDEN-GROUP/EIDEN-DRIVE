# Eiden-Drive Design System

> Canonical visual spec for the app. Source: the "File Manager" dashboard + sign-in reference
> supplied by the owner (list view with context menu, grid view with details panel, file-picker
> dialog, split-card sign-in), re-measured onto Next.js 14 + Tailwind. Supersedes
> `docs/06-ui-ux-theme.md` and `design-system/Eiden-Drive/MASTER.md` (both now synced to this file).
> Brand mark decision: the **stacked-sheets "E" mark + "Eiden Drive" lettering** (vector, traced from the supplied artwork)
> is the logo; the violet E tile and the cream monogram are retired. Brand name: **Eiden Drive**.

## 1. Color system

Tokens live in `app/globals.css` (`:root` + `[data-theme="dark"]`); Tailwind maps them in
`tailwind.config.ts` (`bg-surface`, `text-muted`, `border-line`, `bg-tint`, `text-brand`, …).
Components must use tokens, never raw hex (exception: the fixed tag-dot palette, §1.3).

### 1.1 Core tokens

| Token | Light | Dark | Used for |
|-------|-------|------|----------|
| `--canvas` | `#f4f4f7` | `#0e0e14` | app background |
| `--surface` | `#ffffff` | `#16161e` | cards, panels, dialogs, table rows |
| `--soft` | `#f9f9fc` | `#1a1a23` | favorites pane, subtle grouping |
| `--tint` | `#f1effc` | `#26224a` | selection fill, active nav, progress track |
| `--head` | `#eeebfa` | `#201e3a` | sticky table header band |
| `--line` | `#e8e8ef` | `#2a2a37` | hairline borders, dividers |
| `--ink` | `#2b2b36` | `#ececf4` | primary text |
| `--muted` | `#6e6e7c` | `#9c9cb0` | secondary text, placeholders, counts (lightAA 4.6:1) |
| `--brand` | `#5b3fd0` | `#8f7bff` | primary actions, links, selected text/icons |
| `--brand-deep` | `#4a34b8` | `#a594ff` | hover/pressed brand, teal-600/700 alias target |
| `--icon` | `#4b3bc8` | `#8f7bff` | filled file/folder glyphs (`Glyphs.tsx`) |
| `--danger` | `#e5322d` | `#e5322d` | destructive actions, errors, 95%+ storage bar |

### 1.2 Semantic tokens

| Token | Value | Used for |
|-------|-------|----------|
| `--color-success` / `success` | `#22c32e` (text on light `#15902a`) | healthy states, "Backup ✓", restore success |
| `--color-warning` / `warning` | `#f59e0b` | 80%+ storage bar, caution toasts |
| `--color-error` / `error` | `#dc3545` / `#e5322d` | errors, failed states |
| `--color-primary-500` | `#0d6efd` | info links/badges only (Google-related), never primary CTA |

### 1.3 Tag-dot palette (fixed, `TAG_COLORS` in `Explorer.tsx`)

`#e5322d` `#2331e0` `#22c32e` `#f59e0b` `#ec4899` `#0ea5a4` `#8b5cf6` — assigned per department
tag, rendered as 10 px dots (tree) and white-text chips (details). Never convey meaning by dot
color alone: the tag name is always printed next to it.

### 1.4 Login-only tokens

| Token | Value | Used for |
|-------|-------|----------|
| `--login` | `#6a3db8` (dark `#a594ff`) | "Sign In Account" heading, SIGN IN button |
| art panel | `#E6D7D4` | split-card beige panel behind wave art |
| wave ribbons | red / orange / gold inline SVG | login art panel illustration |

### 1.5 Legacy alias map (do not use in new code)

`tailwind.config.ts` re-points old class names so leftover classes can't render the retired
green/teal/gold palette: `teal-600/700` → brand, `teal-300`/`cream-200` → tint,
`cream-50` → white, `gold-*` → line/muted. New code must use the §1.1 names.

### 1.6 Retired palette (reference only — must not appear in UI)

Forest `#0E1B17` `#122620` `#16302F`, teal `#0C5752` `#0E7A73`, champagne `#CFC292`,
cream `#FEFFF8`, Inter/Anton/Besley. Grep guard: `tests` fail if these hexes appear in
`app/`, `components/`, `public/*.svg` outside this doc.

## 2. Typography

Loaded via `next/font` (`app/layout.tsx`, `display: swap`): **Poppins** 300–700
(`--font-poppins`, `font-body` + `font-display`), **Fredoka** 400–700 (`--font-fredoka`,
`font-brand`, wordmark only), **Roboto** 400–500 (`--font-roboto`, `font-material`, login form).

| Role | Spec |
|------|------|
| File/folder names | 15 px, medium on selected |
| Metadata columns, counts, status bar | 11 px, `text-muted`/`ink/75`, tabular numbers for sizes |
| Toolbar/pane titles | 16 px page title (`.page-title` 1.5 rem semibold), 13 px pane labels semibold |
| Login heading | 30 px medium, `var(--login)`; brand line in Comfortaa |

## 3. Spacing, radius, shadow, motion

* 8-pt rhythm; pane padding 12–16 px; control height 44 px primary / 36 px dense rows.
* Radius: 12 px cards (`.card`), 8–12 px controls, 22 px login art panel, 32 px login card, full pills.
* Shadows: `shadow-pop` (menus/dialogs), `shadow-win` (large overlays); flat elsewhere.
* Motion: 140 ms `pop-in` entrance, 150–300 ms hovers; `prefers-reduced-motion` kills all animation.
* Scrollbars thin and quiet; active nav/tree item = `bg-tint` + brand text + 3 px brand bar on the left edge.

## 4. App shell (`components/shell/AppShell.tsx`)

Sidebar 248 px (logo + "Eiden" Comfortaa wordmark, divider, Pinned row, nav Drive/Activity/
Security/Vault/Users/Storage, promo card with Dismiss/Open remembered in `localStorage`,
Sign out) → top bar 72 px (hamburger collapses sidebar on desktop / drawer on mobile,
page title, avatar menu with name+role+department, theme moon toggle, rail toggle) →
bordered main panel → far-right icon rail ≥ lg (Activity, Security approvals, Backups).
Mobile: sidebar is an overlay drawer; rail hidden; bottom padding reserves the nav.

## 5. Explorer (`components/drive/Explorer.tsx`)

* Panes: Favorites (Recent, Documents, Recovery Bin with live count, Root) + Tags (dept tags
  with dots, click = filter) | main | details panel (≥ xl) else bottom sheet.
* Toolbar: pane toggle, back/forward (real history stack), folder title, debounced search,
  grid/list toggle, sort menu, "…" menu (Upload file, New folder, Refresh).
* Breadcrumb `Root › Folder › …`, clickable, horizontal scroll on mobile.
* List: sticky `--head` header, sortable Name/Tags/Location/Modified/Size/Kind (`aria-sort`),
  expandable indented folder rows (←/→ keyboard), selected row tinted; Location shows
  ☁ Google · 💾 Local · 🛡 Backup.
* Grid: 112 px tiles, 52 px filled glyphs; selecting opens details (preview, key-values
  incl. SHA-256, tag chip, Open/Download/Trash actions).
* Context menu (right-click): Open, Get Info, Download, Copy link, Delete → confirm →
  Recovery Bin; tag dots row.
* Recovery Bin view: per-row Restore (managers enforced server-side), purge dates, 90-day rule.
* Dialogs (`Modal`): header row + ×, Esc closes, focus trapped on open — New folder, Move to Bin.

## 6. Sign-in (`app/(auth)/login/page.tsx`)

Split card, beige art panel (logo, "Eiden / Your files, one drive." Comfortaa, wave SVG;
hidden < lg, logo tile shown above form instead). Right: Material underline email field
(label above, 2 px violet underline on focus), violet SIGN IN, "or", Continue with Google,
helper line; invite-only error ("Ask a manager to invite you"). Form renders client-only
after mount (password-manager extensions otherwise break hydration).

## 7. Logo

The supplied hand-drawn mark (three stacked sheets forming an "E", notch on the top sheet) plus the "Eiden / Drive" lettering,
traced to vector. Files: `public/logo.svg` + `logo-dark.svg` (mark), `logo-full.svg` (lockup), `favicon.svg`/`favicon.ico`,
`icons/*` (PWA, apple-touch, maskable). Ink `#533FAF` on light, `#A99BFF` on dark; clear space = the height of one sheet; minimum 16 px.
Sidebar: mark 38 px + stacked wordmark in Fredoka; collapsed rail: mark only; sign-in: full lockup on the beige panel.
Don't: recolour outside the two inks, stretch, add shadows/outlines, or rebuild the lettering in another font for the lockup.

## 8. Iconography rule

* Files/folders → filled `Glyphs.tsx` (`FileGlyph`, `kindOf` mapping) in `var(--icon)`.
* Actions/navigation → 2 px stroke set (`components/ui/icons.tsx`), one weight everywhere.
* `lucide-react` only when neither set has the glyph (currently: undo/restore arrows).
* Never emoji as icons.

## 9. Accessibility contract

4.5:1 body text (3:1 large/secondary on dark), visible 2 px brand focus ring, real `<label>`
on every input, `role="grid"` rows with `aria-selected`, single `h1` per page, `aria-live`
toasts (auto-dismiss 4 s) + `role="status"` counts, Esc closes every overlay, full keyboard
operation of tree/grid/dialogs, 375 px with no sideways scroll.

## 10. Responsive

Mobile-first: 375 / 768 / 1024 / 1440. < lg: drawer nav, chips instead of tree, bottom-sheet
details, 2-col grid; ≥ xl: 3-pane explorer + rail. `min-h-dvh` sections, `100dvh` app height,
safe-area padding on fixed bars.

## 11. Deviation log (reference had it, we don't — and why)

Dashboard/Goods/Customer/Task nav → real pages; Language dropdown removed (English-only);
orange tile → Eiden tile; Created column → Location column (no created-at in schema);
Rename/Duplicate/Share menu items → Download/Copy link (no such APIs); password login →
magic link + Google (passwordless); file-picker screen → not built (no consumer);
wave art re-drawn as SVG; dark mode added.

## 12. Maintenance

* This file is canonical. `design-system/Eiden-Drive/MASTER.md` mirrors the token tables;
  `docs/06-ui-ux-theme.md` is superseded (banner on top).
* Changing a token: edit `globals.css` pairs (light + dark) → check contrast in both themes →
  update §1 table → run `npm run build` + `npm test` + visual pass at 375/1440 + dark mode.
