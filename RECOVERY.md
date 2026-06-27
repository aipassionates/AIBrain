# RECOVERY.md — Disaster Recovery

How to rebuild the entire automation stack if this machine dies or you move to new hardware.

**Recovery = this repo (all code/config) + Bitwarden (all secrets).** Nothing else is needed.

The core idea: the code references every secret by a **fixed name** (env var or file path). On a
new machine you reinstall software, `git clone` this repo, and restore the secret **values** from
Bitwarden under those **same names** — and the services resume working identically.

---

## 1. What this repo restores (via `git clone`)

| Path | Contents |
|---|---|
| `mcp-servers/` | Custom MCP source: `media-mcp`, `google-analytics-mcp` (no `node_modules`, no secrets) |
| `automations/seo-pipeline/` | SEO pipeline scripts (Supabase key externalized to `process.env.SUPABASE_ANON_KEY`) |
| `infra/pm2/` | All PM2 ecosystem configs (n8n, MCPs, openbb, seo-weekly) |
| `infra/n8n-workflows/` | Exported n8n workflows (contain **no** credential values, only references) |
| `infra/cloudflared/config.yml.example` | Tunnel ingress template |
| `.claude/skills/`, `docs/`, `CLAUDE.md`, `AGENTS.md` | Runbooks + guidance |
| `infra/scripts/` | Helper + restore scripts |

## 2. Secrets — restore from Bitwarden (NEVER in git)

Store each in Bitwarden now. On restore, recreate under the **exact same name**.

| Secret | Restore as | Used by |
|---|---|---|
| **n8n encryption key** | `N8N_ENCRYPTION_KEY` env (set BEFORE first n8n start) | n8n — without it, all stored credentials are unreadable |
| n8n API key | `N8N_API_KEY` User env + `~/.claude.json` + n8n credential store | export script, n8n-local-builder, Cowork auth |
| Supabase anon key | `SUPABASE_ANON_KEY` User env | SEO pipeline scripts |
| WordPress app password | `WP_APP_PASS_PASSIONATES` User env | SEO WordPress import scripts |
| Gmail app password | `GMAIL_APP_PASSWORD` User env | seo-weekly email alerts |
| Google OAuth client | file → `C:\tools\google-analytics-mcp\credentials.json` | google-analytics-mcp |
| Google OAuth token | file → `…\token.json` (or regenerate via `auth.js`) | google-analytics-mcp |
| Cloudflare tunnel creds | file → SYSTEM `.cloudflared\<tunnel-id>.json` | cloudflared tunnel |
| *(future)* Retell / SendGrid / HubSpot / Telnyx keys | n8n credential store / Cowork connectors | sales automation workflows |

> Tunnel ID: `30618ade-6269-438c-b28a-3fca6b8d297b`

## 3. Software to install on the new machine
Node.js · PM2 (+ `pm2-windows-startup`) · cloudflared (Windows service) · yt-dlp + ffmpeg (→ `C:\tools`) ·
LinkedHelper · OpenBB · VS Code + `code tunnel service install`.

## 4. Restore sequence
1. Install all software above.
2. `git clone https://github.com/aipassionates/AIBrain.git C:\Users\user\AIBrain`
3. Restore secrets from Bitwarden: set the env vars (§2) and drop the secret **files** into place.
4. Copy code to live locations: `mcp-servers\*` and `automations\seo-pipeline\*` → `C:\tools\`; run `npm install` in each.
5. Copy `infra\pm2\*.config.cjs` → `C:\Users\user\pm2\`; `pm2 start` each; `pm2 save`.
6. n8n: ensure `N8N_ENCRYPTION_KEY` is set, start n8n, import workflows from `infra\n8n-workflows\`, then re-enter credential **values** in the n8n UI (structure is in the export, values come from Bitwarden).
7. cloudflared: place creds JSON + `config.yml` at the **SYSTEM** path (admin), start the service.
8. Google: run `node auth.js` in `google-analytics-mcp` to regenerate `token.json` if needed.
9. Reconnect Cowork / Claude Code connectors; `code tunnel service install` for remote access.
10. Verify: `pm2 list` (all online), `curl https://api.passionate.agency/healthz` (200), endpoints reachable.

## 5. Why this works
Code from git + secret **values** from Bitwarden under the **same names** = identical behaviour.
You never reconstruct logic — only re-supply secrets. That's the whole disaster-recovery contract.

## 6. Chats & memory (local-only, not in git)
Claude Code transcripts live in `~/.claude/projects/` (machine-bound, may contain secrets — deliberately
not backed up). Durable knowledge is in `MEMORY.md` + this repo.
