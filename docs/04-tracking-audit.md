# 04 — Tracking / audit

`audit_logs(actor, actor_name, action, file_id, detail{before/after hash}, ip, user_agent→browser/os, device_id, ts)` append-only (no member update/delete).

MAC honesty: browsers cannot read MAC. Web = IP + browser + OS + device_id (enrolled). LAN = +MAC/hostname from agent. Inspector shows `username · IP · device · browser · OS`. Views: global /activity + per-file timeline, filters user/dept/action/date/backend.
