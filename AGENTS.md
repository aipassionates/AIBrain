# AGENTS.md

Passionate Agency AI automation stack. Read by Claude Code, Codex, Cursor, Hermes, and any other harness.
Full detail: `docs/` and `skills/`. Claude recovery scripts: `CLAUDE.md`.

---

## Architecture

```
Facebook Lead Ads
  → n8n (PM2 id:0, localhost:5678)
      ← Cloudflare Tunnel (Windows service, LocalSystem)
  → api.passionate.agency
      /api/v1        REST API (header: X-N8N-API-KEY)
      /mcp/cowork    MCP executor (Streamable HTTP, no auth)

LinkedHelper (desktop, CDP port 9222)
  → lhremote → supergateway (6002) → lh.passionate.agency/mcp

yt-dlp + media-mcp (6003) → media.passionate.agency/mcp
google-analytics-mcp (6004) → analytics.passionate.agency/mcp
```

---

## MCP Registry

| Name | Connection | Tools | Notes |
|---|---|---|---|
| **n8n-builder** | stdio `npx n8n-mcp` in `~/.claude.json` | 20+ build tools | Creates/edits/deletes workflows |
| **n8n-executor** | `https://api.passionate.agency/mcp/cowork` | 4 executor tools | list, trigger, get_executions |
| **linkedhelper** | `https://lh.passionate.agency/mcp` | 75 tools | LH app must be open, account started |
| **media-extract** | `https://media.passionate.agency/mcp` | video_info, transcript, download × 2, list | yt-dlp wrapper |
| **google-analytics** | `https://analytics.passionate.agency/mcp` | ga4_run_report, gsc_query_performance, gsc_list_sites | OAuth token.json in C:\tools\google-analytics-mcp\ |
| **Telnyx** | Cowork cloud connector | voice/SMS APIs | Bearer key |
| **Supabase** | Cowork cloud connector | DB management | service key |
| **Gmail** | Cowork cloud connector | read/label/draft/search | OAuth |
| **Google Calendar** | Cowork cloud connector | CRUD events | OAuth |
| **Google Drive** | Cowork cloud connector | file ops | OAuth |
| **Outlook** | Cowork cloud connector | calendar/scheduling | OAuth |

n8n-builder (stdio) and n8n-executor (cloud) are NOT interchangeable — both must be present.

---

## Port Assignments

| Port | Service | Cloudflare subdomain |
|---|---|---|
| 5678 | n8n | api.passionate.agency |
| 6002 | linkedhelper-mcp | lh.passionate.agency |
| 6003 | media-extract-mcp | media.passionate.agency |
| 6004 | google-analytics-mcp | analytics.passionate.agency |
| **6005** | **next available** | — |

---

## Key File Locations

| Resource | Path |
|---|---|
| PM2 configs (canonical) | `infra/pm2/` in this repo |
| PM2 configs (live) | `C:\Users\user\pm2\` |
| Custom MCP source | `mcp-servers/` in this repo (canonical); `C:\tools\` (live until migrated) |
| Google OAuth token | `C:\tools\google-analytics-mcp\token.json` (gitignored — not in repo) |
| n8n exported workflows | `infra/n8n-workflows/*.json` |
| Cloudflare config (REAL) | `C:\Windows\System32\config\systemprofile\.cloudflared\config.yml` (admin) |
| Cloudflare config (ref) | `infra/cloudflared/config.yml.example` |
| Claude Code MCP config | `~/.claude.json` — never display full content |
| LinkedHelper startup | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\LinkedHelper.lnk` |

---

## Critical Non-Obvious Rules

**Cloudflare tunnel config:** The `cloudflared` Windows service runs as LocalSystem and reads from the SYSTEM profile path — NOT `~/.cloudflared/`. All ingress edits require admin PowerShell. See `.claude/skills/add-new-mcp/SKILL.md`.

**`~/.claude.json` edits:** `ConvertFrom-Json → ConvertTo-Json` silently wipes the entire `mcpServers` block. Use raw string insertion to ADD entries. Safe for updating an existing value. See `.claude/skills/restore-claude-json/SKILL.md`.

**n8n API from Claude Code:** Use `https://api.passionate.agency/api/v1` — localhost is SSRF-blocked. Header: `X-N8N-API-KEY` (not `Authorization: Bearer`).

**ToolCode in n8n:** Sandbox blocks `fetch` and `require('http')`. Use `ToolHttpRequest` nodes (`@n8n/n8n-nodes-langchain.toolHttpRequest` v1.1) with `{placeholder}` syntax instead.

**n8n workflow settings API:** Only `{ "executionOrder": "v1" }` in settings object — no `binaryMode` or undocumented fields (ZodError).

**LinkedHelper version updates:** After LH auto-updates, three paths must be updated manually: startup shortcut, PM2 LINKEDHELPER_PATH, ~/.claude.json. See `.claude/skills/update-linkedhelper-version/SKILL.md`.

**After n8n API workflow edits:** Deactivate then reactivate the workflow to re-register webhooks — API updates alone don't trigger registration.

---

## Adding a New MCP (6-step pattern)

Full detail: `.claude/skills/add-new-mcp/SKILL.md`. Summary:

1. Install: `npm install -g <pkg>` (npm) or put custom code in `mcp-servers/<name>/`
2. Create PM2 config in `infra/pm2/<name>.config.cjs` (supergateway pattern, next port)
3. `pm2 start infra/pm2/<name>.config.cjs && pm2 save`
4. Add ingress to SYSTEM cloudflared config (admin PS) → `sc.exe stop/start cloudflared`
5. Add DNS CNAME in Cloudflare Dashboard → CNAME to tunnel ID
6. Add Cowork connector URL: `https://<subdomain>.passionate.agency/mcp`

---

## Products

| Product | Status | Key workflows |
|---|---|---|
| Sales automation | In progress | Facebook Lead Ads → Retell AI → SendGrid → HubSpot |
| LinkedIn outreach | Active | LinkedHelper campaigns via MCP |
| AI receptionist | Planned | — |
| Media extraction | Active | yt-dlp via media-mcp |
| SEO / analytics | Active | GA4 + GSC via google-analytics-mcp (passionates.com) |
