# MASTER — Eiden-Drive design system (Source of Truth mirror)

> Canonical spec: `docs/design.md`. This file mirrors its token tables so skill/agent
> lookups land on current values. History: originally generated from skill `ui-ux-pro-max`
> query `company file manager dashboard responsive` (Flat, dense, subtle motion); fully
> re-specified in commit `00abc64` from the File-Manager reference (violet system).

* Style: Flat 2D, light + dark (`[data-theme="dark"]`), 150–300 ms hovers, 140 ms `pop-in`,
  SVG-only icons (filled `Glyphs.tsx` for files/folders, 2 px stroke set for actions).
* Tokens (`app/globals.css`): `--canvas #f4f4f7/#0e0e14`, `--surface #fff/#16161e`,
  `--soft #f9f9fc`, `--tint #f1effc` (selection), `--head #eeebfa` (table header),
  `--line #e8e8ef`, `--ink #2b2b36`, `--muted #6e6e7c` (4.6:1 light), `--brand #5b3fd0` (dark `#8f7bff`),
  `--brand-deep #4a34b8`, `--icon #4b3bc8`, `--danger #e5322d`; success `#22c32e`,
  warning `#f59e0b`; login-only `--login #6a3db8`, art `#E6D7D4`.
* Tag dots (fixed): `#e5322d #2331e0 #22c32e #f59e0b #ec4899 #0ea5a4 #8b5cf6`.
* Type: Poppins (UI), Comfortaa (wordmark), Roboto (login); 15 px names / 11 px metadata.
* Layout: mobile-first 375/768/1024/1440, no h-scroll, drawer nav mobile, 3-pane ≥ xl,
  44 px primary targets, breadcrumbs, confirm-before-destroy, toast every async result.
* A11y: 4.5:1 body, visible focus, labels, keyboard tree/grid/dialogs, reduced-motion honored.
* Retired (must not render): `#0E1B17 #122620 #0C5752 #CFC292 #FEFFF8`, Inter/Anton/Besley.
* Page overrides go in `pages/<name>.md` and win over this file.
