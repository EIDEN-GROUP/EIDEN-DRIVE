-- P2 additions: AI opt-in + vault enrollment placeholders
alter table profiles add column if not exists allow_ai boolean default false;
alter table profiles add column if not exists totp_secret_enc text;
alter table profiles add column if not exists webauthn_cred text;
