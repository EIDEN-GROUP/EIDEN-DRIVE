# UX test — Explorer pass (run against staging or prod, record result)

Date: __________  Tester: __________  Build: __________

## Task scripts (time each, note friction)
1. Log in with email link → land on /drive. Expect ≤ 2 min inbox-to-drive.
2. Find "contract" via search. Expect ≤ 10 s to first result.
3. Switch grid → list, sort by size. Expect state kept, no reload.
4. Upload a 1 MB PDF into Projects. Expect progress → success toast → appears in list.
5. Trash it, then restore from Recovery Bin. Expect confirm dialog → toast → bin count updates.
6. Open Vault → unlock with passkey. Expect 6 h session note visible.

## Heuristics (Nielsen, adapted) — mark pass/fail
| # | Check | Result |
|---|-------|--------|
| 1 | Breadcrumb always shows where I am | |
| 2 | Every destructive action confirms first | |
| 3 | Every async action shows loading then toast | |
| 4 | Empty states tell me what to do next | |
| 5 | Errors say what happened + how to recover | |
| 6 | Works at 375 px wide, no sideways scroll | |
| 7 | Keyboard only: tab order sane, Esc closes dialogs | |
| 8 | Reduced-motion on: no animation, still usable | |

## Accessibility spot-checks
- [ ] VoiceOver/TalkBack reads file names + actions in order
- [ ] Contrast spot-check body text ≥ 4.5:1 (use OS picker)
- [ ] Focus ring visible on every control

## Sign-off
All P0 tasks ≤ target time, no fail above → PASS. File result in `docs/11-project-journal.md` test log.
