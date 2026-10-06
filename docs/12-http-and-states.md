# 12 — HTTP & state catalog (every code has a home)

## Error pages (web)

| Code | Surface | File |
|------|---------|------|
| 404 | Branded page: logo, code, search-the-drive, Back to Drive | `app/not-found.tsx` → `HttpError` |
| 500 | Boundary per route group: ref code, Try again, Back to Drive | `app/error.tsx` + `app/global-error.tsx` → `HttpError` |
| 401 / 403 | Middleware bounce to `/login?next=` (+ Sign in button on the component) | `middleware.ts`, `HttpError` |
| everything else (400, 405, 408, 409, 410, 413, 415, 422, 429, 501, 502, 503, 504) | `HttpError` component: code + title + one recovery sentence + Back to Drive (+ Try again where retry makes sense) | `components/ui/HttpError.tsx` (`HTTP_ERRORS` map) |

## API status contract (all routes)

| Code | When | Example |
|------|------|---------|
| 200/201 | ok / created | drive list, upload, invite, access-request |
| 400 | bad shape (Zod `safeParse`) | trash without `file_id`, bad email |
| 401 | no session | every authed route; middleware emits it for `/api/*` |
| 403 | signed in, wrong role | member hits restore/users/health |
| 404 | row missing | rename unknown file, download unknown id |
| 405 | wrong method | `GET /api/access-requests` (Next emits it; covered by contract test) |
| 409 | already exists | invite an existing email |
| 413 | file > 100 MB | `upload-url` Zod max (message names the limit) |
| 429 | throttled | login-attempt reporter (IP throttle); Supabase OTP limits surface as friendly copy on login |
| 500 | unexpected | DB error text (no secrets — Supabase messages contain no keys) |
| 501 | stubbed on purpose | passkey unlock path (says so instead of pretending) |
| 502 | Google failed after our DB write/before it | trash/restore/rename/sync wrap Drive calls; bin row rolled back |
| 503 | backend not configured | no refresh token, no bucket, no service key, agent token unset |

410/408/415/422 have component copy ready; the API uses 404/400 with specific messages for those cases today.

## Loading states (every important page)

| Surface | Implementation |
|---------|----------------|
| Full-page | `app/loading.tsx` (route groups inherit it) |
| Explorer table/grid | skeleton rows/tiles (`.skel` pulse, `aria-busy`), not a spinner |
| Cards (Storage, Security, Users) | inline "Reading …" status lines (`role="status"`) |
| Buttons | every async button disables + relabels (`Sending…`, `Saving…`, `Uploading X…`, `Syncing…`, `Queuing…`) |
| Forms | submit disabled while pending; errors stay mounted with `role="alert"` |
| Images | logo + glyphs are local SVG/PNG (instant); no remote images to skeletonize |
| Infinite scroll | paged "Load more" (explicit, keyboard-safe) instead of scroll-jacking |
| Background ops | `syncing`/`uploading` labels + toasts on completion; jobs feed on Storage/Security |
