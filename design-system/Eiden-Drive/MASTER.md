# MASTER — Eiden-Drive design system (Source of Truth)

Skill `ui-ux-pro-max` query: `company file manager dashboard responsive --density 8 --variance 4 --motion 3` → **Flat, dense dashboard, subtle motion**.

* Style: Flat 2D, light+dark, no gradients/shadows (except card `0 10px 30px rgba(0,0,0,.28)` on dark), 150-300ms hovers, SVG (Lucide) icons only.
* App tokens (EIDEN brand wins for shell): green-950 `#0E1B17`/900 `#122620`/800 `#16302F`, teal-600 `#0C5752`, gold-500 `#CFC292`, cream-50 `#FEFFF8`; functional blue `#0d6efd`, success `#198754`, warning `#ffc107`, error `#dc3545`.
* Type: Inter body (base 1.125rem per Design.md), Anton display uppercase, Besley italic accents.
* Layout: mobile-first, 375/768/1024/1440, no h-scroll, bottom nav ≤5 mobile, 3-pane desktop, 44×44 touch, 8px spacing, CLS<0.1, lazy previews.
* A11y: 4.5:1, visible focus, labels (no placeholder-only), keyboard nav, reduced-motion honored, deep links per file/folder.
* Page overrides go in `pages/<name>.md` and win over this file.
