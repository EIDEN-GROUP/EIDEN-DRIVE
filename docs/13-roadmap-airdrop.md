# 13 — Roadmap: AirDrop / Quick Share (FUTURE — not built)

Nearby device-to-device sharing without the cloud round-trip: discover Eiden
sessions on the LAN, send files peer-to-peer with explicit accept on both ends.

## Why it fits
Uploads already mirror to Supabase/Google/USB. Nearby share covers the missing
leg: phone ↔ office PC in the same room, no mobile data, no waiting on sync.

## Planned shape (do NOT build until approved)
- Discovery: mDNS/BLE advertisement of `eiden-<username>` on the LAN. Never
  silent — visible "discoverable" toggle with auto-off timer.
- Transfer: WebRTC data channel (encrypted by default) or LAN HTTPS with a
  one-time 6-digit pairing code shown on the receiver. Sender picks files from
  Explorer → "Send to nearby device".
- Receiving: explicit Accept per transfer, destination = own upload prefix.
  Received files enter the normal pipeline (index, audit, mirrors per toggles).
- Safety rules (non-negotiable): accept-before-bytes always; no auto-accept;
  same 100 MB caps as uploads; every completed transfer audit-logged with both
  device ids; sender sees receiver's display name + avatar before sending.
- Fallback: if discovery finds nothing in 15 s, offer the existing share link
  instead of an eternal spinner.

## Open questions (ask before building)
1. Mobile apps don't exist yet — nearby share needs at least a PWA with
   WebRTC/Bluetooth. PWA first, or skip until native apps?
2. Should guests (no account) be able to receive via a claim link, or
   members-only?
