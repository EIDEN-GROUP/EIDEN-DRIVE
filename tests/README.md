# Tests

## Unit (no server, no secrets) — `npm test`
`tests/unit/*.test.ts` via Vitest: file classification/badges/sizes, alert thresholds,
role matrix + approval rules, vault AES-GCM round-trip + 6 h session logic.

## Live (needs a running server) — `BASE_URL=… npm run test:live`
* `tests/api/contracts.test.ts` — anonymous API contracts (401s, OAuth gate, public assets).
* `tests/e2e/smoke.test.ts` — middleware bounces anon to `/login?next=`, login form renders, 404 handling.
* `tests/ui/render.test.ts` — one-h1, labels, 44 px targets, SVG-only icons, viewport, alt text.

Local: `npm run dev` in one shell, then `EIDEN_BASE_URL=http://127.0.0.1:3000 npm run test:live`.
Prod: `EIDEN_BASE_URL=https://drive.eiden-group.com npm run test:live`.

## Manual
`tests/ux/checklist.md` — task-timed UX pass + heuristics + a11y spot-checks. Record outcome in `docs/11-project-journal.md`.
