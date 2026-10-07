# docs/frontend — redesign + fix log

Everything produced in the "mirror the reference design + fix every bug" pass lives here.
No secrets in these files — env var **names** only.

| File | What it covers |
|------|----------------|
| [`01-redesign.md`](01-redesign.md) | Reference-design analysis (from the 4 screens), design tokens, layout, every component, file map, deliberate deviations |
| [`03-invites-and-profiles.md`](03-invites-and-profiles.md) | Invite-only onboarding: profile trigger (migration 0005), invite API + form, `/welcome` landing, closed sign-up, one-time Supabase settings |
| [`04-calendar-tags-drives-vault.md`](04-calendar-tags-drives-vault.md) | Calendar rebuild (reference mirror), real tags, Drives moved into the pane + Upload split button, real encrypted Vault, sidebar rail + live storage card; apply checklist |
| [`05-file-readers-and-icons.md`](05-file-readers-and-icons.md) | Universal in-app file reader (Office, PDF, archives, CSV/JSON, ebooks, fonts, legacy/binary…) with a security model + new file-type icons |
| [`02-bugfix-log.md`](02-bugfix-log.md) | Every bug found → fix → files → how it was verified, plus the **apply checklist** (migration, env vars) |

Older project docs (`docs/00`–`docs/11`) are unchanged except for the factual corrections listed at the end of `02-bugfix-log.md`.

**Request log (this pass)**
1. "Update the full frontend design UI/UX, mirror the image exactly (dashboard + login), no generic design" → `01-redesign.md`.
2. "Auto-fix any bug you found" → `02-bugfix-log.md`.
3. "Put it all in md files" + "all md files into `docs/frontend/`" → this folder.
