# 05 — Security + vault + 2FA

Auth: Google SSO + MFA enforced. Supabase RLS on all tables; download links are signed for 5 min; rate-limit auth/OTP/share; immutable audit.

Safe-delete: member delete → Recovery Bin (90d) + snapshot; sensitive (Finance/Legal/Contracts/HR) needs 2nd approver; permanent = dual-admin + hash retained.

Vault (`/vault`): per-item AES-256-GCM, KEK in Supabase Vault; only Manager/Admin create; view needs a fresh TOTP code (passkey/WebAuthn not yet available), 6h session; 5 wrong codes lock for 5 min (`vault_auth.authed_at`), then re-2FA. All views logged.
