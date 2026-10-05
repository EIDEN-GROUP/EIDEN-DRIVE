# 01 — Architecture

```
EIDEN-DRIVE (Vercel Next.js + Supabase Cloud)
  /drive /activity /security /vault /users /storage
    |                 |                  |
Google Drive API  Supabase DB        Local Agent (office PC, outbound WSS only)
Shared Drives     file_index/audit   -> SMB \\192.168.1.1\share (router USB staging)
primary cloud     Recovery Bin 90d   -> hash/index/controlled ops
```

Decisions: Shared Drives = source of truth cloud; USB = ingest/staging (`drop → index → Upload to Google`); no SMB/FTP/router-admin exposed; Changes API + webhook (no polling).
