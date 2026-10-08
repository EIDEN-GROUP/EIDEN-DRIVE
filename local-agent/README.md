# Local agent runbook (office PC)
# 1. Mount router USB on the PC (e.g. Z: -> \\192.168.1.1\share), or set SMB_SHARE.
# 2. Fill env at the end: AGENT_WS_URL, AGENT_TOKEN, SMB_SHARE, SMB_USER, SMB_PASS
# 3. node src/index.js  (heartbeat + job pull; loop every 60s via Task Scheduler/systemd)
# Allowlisted ops only — see src/index.js ALLOW set. Every op logs mac/hostname to audit.
#
# USB backup worker (new): `node src/index.js poll`
# - heartbeats to POST /api/agent every 60s and pulls pending jobs
# - executes `usb-upload` jobs: downloads the bytes URL from the job payload,
#   writes to <share>/eiden/<jobid>-<name>, reports to POST /api/agent/complete
# - unknown job kinds are left pending for a newer agent; failures are reported
#   with the error so the web UI shows exactly what broke
