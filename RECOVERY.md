# RECOVERY.md — Disaster Recovery

What to do if this Windows machine dies, is wiped, or you move to new hardware.

This repo is the **documentation + config backbone** for rebuilding the stack. It does
**not** contain secrets — those live in your password manager (by design). Recovery =
this repo **+** the password manager.

---

## What IS backed up here (git)

- All docs (`docs/`, `AGENTS.md`, `CLAUDE.md`)
- Operational skills (`.claude/skills/*/SKILL.md`) — add-MCP, key rotation, machine restore, etc.
- PM2 ecosystem configs (`infra/pm2/`)
- Cloudflare tunnel config **template** (`infra/cloudflared/config.yml.example`)
- n8n workflow exports, no credential values (`infra/n8n-workflows/`)
- Helper scripts (`infra/scripts/`)
- Custom MCP server source (`mcp-servers/`)

## What is NOT here — restore from your password manager

| Secret | Why it can't be in git |
|---|---|
| Cloudflare tunnel credentials JSON (`30618ade-…`) | Grants control of the tunnel |
| **n8n encryption key** (`N8N_ENCRYPTION_KEY`) | Without it, every stored n8n credential is unreadable |
| n8n credential VALUES (API keys inside n8n) | Live secrets |
| Google OAuth `credentials.json` / `token.json` | Account access (token re-issuable via `auth.js`) |
| `N8N_API_KEY`, Retell/SendGrid/HubSpot/Telnyx keys | Live secrets |

> ⚠️ Back these up to your password manager **now** if you haven't. They are the only
> non-recoverable part of the system.

---

## Rebuild order (summary)

Full step-by-step: **`.claude/skills/restore-machine/SKILL.md`** (and `infra/scripts/restore-machine.ps1`).

1. Install Node.js, PM2, cloudflared, yt-dlp/ffmpeg, LinkedHelper
2. `git clone` this repo
3. Restore secrets from password manager (env vars, n8n encryption key, cloudflared creds, Google `credentials.json`)
4. Start n8n + import workflows; re-enter n8n credential values
5. `pm2 start` each `infra/pm2/*.config.cjs`; `pm2 save`
6. Restore cloudflared config to the **SYSTEM** path (admin) and start the service
7. Re-run Google OAuth (`auth.js`) to regenerate `token.json`
8. Reconnect Cowork / Claude Code connectors

## Remote access (Mac → this PC)

VS Code Remote Tunnel runs as an auto-starting service (registry Run key
`Visual Studio Code Tunnel`). On a rebuild: `code tunnel service install`, sign in with
the same GitHub/Microsoft account, then connect from the Mac via
**Remote Tunnels: Connect to Tunnel**.

---

## Chats & memory (local-only, not in git)

Claude Code chat transcripts and auto-memory live in
`~/.claude/projects/C--Users-user/` — they are **not** in this repo (they can contain
secrets). They aren't needed to rebuild the system. The durable knowledge is captured in
`MEMORY.md` and this repo's docs.
