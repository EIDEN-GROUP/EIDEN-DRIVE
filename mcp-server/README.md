# MCP wiring (agent host, e.g. Claude / Opencode)
# Transport: stdio for local, SSE for hosted. Identity header: `x-ai-user: {userId}`.
# Policy enforced in src/index.ts assertAIAllowed + API-side owner check.
# Member toggle in DB: profiles.allow_ai boolean (add via migration 0002) — member opts in own AI only.
