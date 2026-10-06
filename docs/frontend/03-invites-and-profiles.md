# 03 — Invite-only onboarding + automatic profiles

Why: accounts must only be created by managers/admins (see `docs/02`), and every auth user needs a `profiles` row
(role lives there). Before this, anyone typing an email on the login page got an account, and nothing created the profile row.

## What was added
| Piece | File | Behaviour |
|-------|------|-----------|
| Profile trigger | `supabase/migrations/0005_profile_trigger.sql` | `on_auth_user_created` → `handle_new_user()` inserts a profile for every new auth user. **Always `role = 'member'`** (sign-up metadata is user-controlled, never trusted for role). Unique username from the email local part (suffix added on collision). `on conflict do nothing` so a hand-made profile is never overwritten. Back-fills existing users without a profile. Re-runnable. |
| Invite API | `app/api/users/invite/route.ts` | `POST {email, role?, department_tag?}`. Managers → members only; admins → any role. Calls `auth.admin.inviteUserByEmail` (service role), then sets role + department on the profile. 400 bad email · 403 not allowed · 409 already registered · audit entry written. |
| Invite form | `components/users/InviteMember.tsx`, `app/(app)/users/page.tsx` | "Invite member" button (managers/admins only) → modal: email, role (admins can pick manager/admin), department tag (suggestions from existing tags). Users page restyled as a table with role pills. |
| Invite landing | `app/(auth)/welcome/page.tsx` (+ `/welcome` public in `middleware.ts`) | Invite emails return the session in the URL hash, which only the browser can read; this page lets the client library store it, then goes to `/drive`. Expired/used link → clear message after 8 s. |
| Closed sign-up | `app/(auth)/login/page.tsx` | `signInWithOtp({ shouldCreateUser: false })`; unknown email → "No account for this email yet. Ask a manager to invite you." |
| Tests | `tests/unit/invite.test.ts` | 5 cases: anonymous/member rejected, bad email = 400, manager limited to members, admin applies role+dept, duplicate = 409. |

## Do this once (Supabase dashboard) — required for it to work
1. **SQL editor:** run `0004_rls_hardening.sql` (if not yet), then `0005_profile_trigger.sql`.
2. **Promote the first admin** (see below).
3. **Authentication → Providers → Email → turn OFF "Allow new users to sign up"** (this is what actually closes self-sign-up, including Google sign-in; `shouldCreateUser:false` only covers the email form). Admin invites still work.
4. **Authentication → URL Configuration → Redirect URLs:** add `https://drive.eiden-group.com/welcome` and `http://localhost:3000/welcome` (and keep `/api/auth/callback`).
5. **Authentication → Email templates → Invite user:** optional — rename the sender/subject to "Eiden".
6. Env: `SUPABASE_SERVICE_ROLE_KEY` (already required) and `NEXT_PUBLIC_APP_URL` (used to build the invite redirect; falls back to the request origin).

### First admin
```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'YOUR_EMAIL_HERE');
```
(The trigger guarantees the row exists once 0005 has run; the back-fill covers accounts that signed up earlier.)

## Behaviour notes / limits
* Re-inviting an existing email returns 409; there is no "resend invite" button yet (Supabase dashboard → Authentication → Users can resend).
* Changing an existing person's role/department from the UI is not built yet (API exists: `PATCH /api/users`).
* Invited users sign in later with the normal email-link form (no passwords).
* Not run against a live Supabase in this session: the SQL, the real invite email, and the `/welcome` hash hand-off. Unit tests mock the admin client. Acceptance test: invite a second email you own → open the mail → land on `/drive` as a member.
