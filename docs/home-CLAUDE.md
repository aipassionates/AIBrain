# CLAUDE.md — Passionate Agency AI Automation Project

> **Project repo:** `C:\Users\user\passionate-agency\` — open that folder in VS Code or Claude Code for project work.
> Full cross-harness context: `passionate-agency/AGENTS.md` | Skills: `passionate-agency/skills/` | Docs: `passionate-agency/docs/`
> When working on project files, prefer opening passionate-agency/ as the working directory.

> This file is read automatically by Claude Code at session start.
> Keep it short. Only include things Claude cannot infer from code alone.
> Prune ruthlessly — stale guidance is worse than none.

---

## Core Principles

### 1. Think Before Coding
Pause before any implementation. Ask: *What is the actual problem? What is the simplest fix?*
Never start typing code as a reflex. A wrong plan executed fast is just faster failure.

### 2. Simplicity First
The best solution has the fewest moving parts. Prefer editing one node over rebuilding a workflow.
Prefer a config file change over a new script. Never add abstraction without a concrete reason.

### 3. Surgical Changes
Touch only what is broken. Do not refactor surrounding code while fixing a bug.
Do not "improve" things that are working. If a change could break existing functionality, stop and confirm with the user first.

### 4. Goal-Driven Execution
Every action must map to the user's stated goal. If a step feels tangential, it probably is.
Abandon approaches that aren't working — don't keep retrying the same failing command.

---

## Project Architecture

```
Facebook Lead Ads
      │
      ▼
   n8n (localhost:5678, PM2 id:0)
      │  ← Cloudflare Tunnel (cloudflared Windows service, AUTO_START)
      ▼
api.passionate.agency          ← public HTTPS endpoint
      │
      ├── /api/v1/...          ← REST API (requires X-N8N-API-KEY header)
      └── /mcp/cowork          ← MCP Server Trigger (Streamable HTTP, no auth)
                │
                └── Claude Code + Cowork (cloud connector → /mcp/cowork)

LinkedHelper (desktop app, auto-start via Startup folder)
      │
      ▼
   lhremote MCP (CDP port 9222)
      │
   supergateway (localhost:6002, PM2 id:1)
      │  ← Cloudflare Tunnel (same cloudflared service)
      ▼
lh.passionate.agency/mcp      ← public HTTPS endpoint (Streamable HTTP, no auth)
      │
      └── Cowork (custom connector → lh.passionate.agency/mcp)

yt-dlp + FFmpeg (C:\tools\)
      │
   media-mcp Node.js server (C:\tools\media-mcp\)
      │
   supergateway (localhost:6003, PM2 id:2)
      │  ← Cloudflare Tunnel (same cloudflared service)
      ▼
media.passionate.agency/mcp   ← public HTTPS endpoint (Streamable HTTP, no auth)
      │
      └── Cowork (custom connector → media.passionate.agency/mcp)
```

**Key services:**
| Service | How it runs | Auto-start |
|---|---|---|
| n8n | PM2 id:0 (Node) | pm2-windows-startup → Registry Run key |
| linkedhelper-mcp | PM2 id:1 (supergateway + lhremote) | pm2-windows-startup → Registry Run key |
| media-extract-mcp | PM2 id:2 (supergateway + media-mcp) | pm2-windows-startup → Registry Run key |
| cloudflared | Windows service (LocalSystem) | ✅ AUTO_START |
| LinkedHelper app | Desktop app | ✅ Startup folder shortcut |

**LinkedHelper startup note:** The MCP connects to an already-running LinkedHelper instance via CDP — it does NOT launch the app itself. LinkedHelper must be open on screen with LinkedIn profiles logged in and active before any MCP campaign/profile tools will work. The Startup folder shortcut auto-launches the app on boot with `--remote-debugging-port=9222`. After a LinkedHelper update, check that the shortcut target points to the newest `app-X.X.XX` folder — it does not update automatically.

**Key workflow:** "Cowork MCP Tools" (ID: `2zxCSXHtmY76XU69`)
- MCP Server Trigger → path `cowork`, typeVersion 2, Streamable HTTP
- Tools: `list_workflows`, `trigger_webhook_workflow`, `get_recent_executions`, `get_execution_details`
- All tool nodes are `ToolHttpRequest` (NOT ToolCode — sandbox blocks fetch and http module)

---

## Security Rules — READ THESE FIRST

### ❌ NEVER do these
- **Never read `~/.claude.json` aloud** or display its contents in conversation — it contains session history that may include sensitive data
- **Never hardcode API keys** in workflow nodes, scripts, or config files — use n8n Credential store or env vars
- **Never paste an API key** into chat, even partially — rotate immediately if this happens
- **Never use `cat` or `Read` on `~/.claude.json`** — use targeted PowerShell to extract specific values only
- **Never commit API keys** to git repositories

### ✅ Always do these
- Use `$env:N8N_API_KEY` in PowerShell commands (never inline the key string)
- Use n8n Credential store for API keys used inside workflow nodes
- Use `Read-Host -AsSecureString` when a new key needs to be captured interactively
- Reference credentials by name in n8n nodes, not by value

### Updating ~/.claude.json safely

**⚠️ NEVER use ConvertFrom-Json → ConvertTo-Json to ADD a new mcpServers entry.**
PowerShell 5.1's round-trip on this file is lossy — it silently wipes the entire mcpServers section,
destroying all working MCP configs. This happened once and cost significant rework.

**To ADD a new MCP server entry** — raw JSON insertion only:
```powershell
$cfgPath = "$env:USERPROFILE\.claude.json"
$raw = Get-Content $cfgPath -Raw

# Build the new entry as a JSON string (escape backslashes)
$newEntry = '"linkedhelper":{"command":"node","args":["C:\\Users\\user\\AppData\\Roaming\\npm\\node_modules\\lhremote\\dist\\cli.js","mcp"],"env":{}}'

# Insert before the closing } of mcpServers block
$raw = $raw -replace '("mcpServers"\s*:\s*\{)([\s\S]*?)(\n\s*\})', "`$1`$2,`n    $newEntry`$3"
Set-Content $cfgPath $raw -Encoding utf8

# Verify: file should be LARGER than before, all previous server names still present
$v = Get-Content $cfgPath -Raw | ConvertFrom-Json
$v.mcpServers.PSObject.Properties.Name   # must list ALL servers including old ones
```

**To UPDATE a single value in an existing mcpServers entry** — ConvertFrom-Json is safe for targeted edits (reading one field, writing it back):
```powershell
$cfg = Get-Content "$env:USERPROFILE\.claude.json" | ConvertFrom-Json
$cfg.mcpServers.'n8n-local-builder'.env.N8N_API_KEY = $newKey
$cfg | ConvertTo-Json -Depth 20 | Set-Content "$env:USERPROFILE\.claude.json" -Encoding utf8
```

**⚠️ If mcpServers is missing entirely** (Claude Code session writes can wipe it — known issue):
Use this recovery script. It inserts the block at the top of the JSON using raw string manipulation:
```powershell
$key = [System.Environment]::GetEnvironmentVariable("N8N_API_KEY", "User")
$cfgPath = "$env:USERPROFILE\.claude.json"
$raw = Get-Content $cfgPath -Raw -Encoding utf8
$mcpBlock = "  ""mcpServers"": {`n    ""n8n-local-builder"": {`n      ""command"": ""npx"",`n      ""args"": [""n8n-mcp""],`n      ""env"": {`n        ""N8N_API_URL"": ""https://api.passionate.agency/api/v1"",`n        ""N8N_API_KEY"": ""$key"",`n        ""MCP_MODE"": ""stdio"",`n        ""LOG_LEVEL"": ""error"",`n        ""DISABLE_CONSOLE_OUTPUT"": ""true""`n      }`n    }`n  },"
$updated = $raw -replace '^(\s*\{)', "`$1`n$mcpBlock"
Set-Content $cfgPath $updated -Encoding utf8
# Verify
$v = Get-Content $cfgPath -Raw; Write-Host "mcpServers present: $($v -match '""mcpServers""')"
```

**Important:** LinkedHelper and Media Extract are cloud connectors (no entry in ~/.claude.json).
**n8n-local-builder is NOT a cloud connector** — it is a stdio server stored in ~/.claude.json.
These serve different purposes and both are required (see "n8n MCP Architecture" below).

---

## n8n MCP Architecture — TWO separate connections

**Why both exist and why neither can replace the other:**

| | n8n-local-builder | Cloud connector (/mcp/cowork) |
|---|---|---|
| **Config location** | `~/.claude.json` (stdio) | Cowork cloud connector registry |
| **Works in** | Claude Code only | Claude Code + Cowork |
| **Purpose** | BUILD: create/edit/delete workflows, manage credentials, validate, audit | EXECUTE: trigger workflows, list, monitor executions |
| **Tools** | 20+ management API tools | 4 executor tools |
| **Auth** | N8N_API_KEY env var | None (n8n workflow handles auth internally) |
| **Can expose via web?** | ⚠️ Risky — full management access incl. delete/credential access | ✅ Already exposed at /mcp/cowork |

**Can we simplify to one web endpoint?**
Technically yes (wrap n8n-mcp in supergateway like linkedhelper). **Not recommended** — exposing full n8n management (delete workflows, access all credentials, audit instance) to the internet is a significant risk even with URL obscurity. Keep the split: local for management, web for execution.

---

## n8n API Key Locations (complete list)

These are ALL places the n8n API key lives. When rotating, update in this order:

| # | Location | How to update | Risk if missed |
|---|---|---|---|
| 1 | **n8n UI → Settings → API** | Revoke old key, generate new one | Old key still valid if not revoked |
| 2 | **n8n Credential store** (`httpHeaderAuth` credential) | n8n UI → Settings → Credentials | Cowork MCP tools fail with 401 |
| 3 | **`~/.claude.json`** (`mcpServers.n8n-local-builder.env.N8N_API_KEY`) | Run recovery script above or use ConvertFrom-Json targeted update | Claude Code n8n-local-builder breaks |
| 4 | **User env var** (`N8N_API_KEY`) | `[Environment]::SetEnvironmentVariable("N8N_API_KEY", $newKey, "User")` | PowerShell commands and recovery script break |
| 5 | **Local transcript files** (`.claude/projects/.../*.jsonl`) | Read-only history — rotating the key is sufficient | None (old key is invalidated) |

**The goal:** Steps 1+2+3+4 on every rotation. Step 3 uses the User env var set in step 4, so do step 4 first.

---

## n8n Workflow Patterns

### Do NOT use ToolCode for HTTP calls
The n8n toolCode sandbox blocks `fetch` and `require('http')`. Use `ToolHttpRequest` instead:
- Node type: `@n8n/n8n-nodes-langchain.toolHttpRequest` version 1.1
- Supports `{placeholder}` syntax in URL and body for AI-filled parameters
- Reference n8n credentials for auth headers — no hardcoding

### MCP Server Trigger (typeVersion 2)
- Endpoint format: `https://api.passionate.agency/mcp/{path}` (no `/sse` or `/http` suffix)
- Transport: Streamable HTTP (GET and POST at same URL)
- Authentication: None (rely on Cloudflare access rules if needed)
- Workflow must be **Active** (toggle on) for the webhook to register

### n8n API calls (server-side)
- Use `localhost:5678` for calls FROM inside n8n workflows (no SSRF issue)
- Use `https://api.passionate.agency/api/v1` for calls FROM Claude Code (SSRF blocks localhost)
- Header: `X-N8N-API-KEY: [key]` (not `Authorization: Bearer`)

### Workflow update via API
When using `n8n_update_full_workflow`, the `settings` object must only contain known fields:
```json
{ "executionOrder": "v1" }
```
Do not include `binaryMode` or other undocumented fields — the API will reject with ZodError.

### After editing a workflow
Always deactivate then reactivate the workflow (or use the n8n UI Save button) to re-register webhooks. API-only updates may not trigger webhook registration.

---

## Claude Code ↔ n8n Connection

Claude Code has TWO n8n connections serving different purposes:

### 1. n8n-local-builder (stdio — BUILDER)
**Config:** `~/.claude.json` → `mcpServers.n8n-local-builder`
**Command:** `npx n8n-mcp` with N8N_API_KEY + N8N_API_URL env vars
**API URL:** `https://api.passionate.agency/api/v1` (NOT localhost — SSRF blocks it)
**Tools:** create/edit/delete workflows, manage credentials, validate, audit, search nodes/templates

**Verify:**
```powershell
claude mcp list   # should show: n8n-local-builder
```
**If missing from `claude mcp list`:** Run the recovery script in "Updating ~/.claude.json safely" above.

### 2. Cloud connector (web — EXECUTOR, shared with Cowork)
**URL:** `https://api.passionate.agency/mcp/cowork`
**n8n workflow:** "Cowork MCP Tools" (ID: `2zxCSXHtmY76XU69`) must be **Active**
**Tools:** list_workflows, trigger_webhook_workflow, get_recent_executions, get_execution_details

**If disconnected:**
- Check n8n is running: `pm2 list` (id:0 online)
- Check tunnel: `curl.exe https://api.passionate.agency/healthz` (expect 200)
- Check workflow is Active in n8n UI (toggle must be ON)
- Reconnect in Cowork → Settings → Connectors → n8n → Reconnect

---

## Cowork Connection

| Connector | URL | Tools |
|---|---|---|
| n8n | `https://api.passionate.agency/mcp/cowork` | list_workflows, trigger_webhook_workflow, get_recent_executions, get_execution_details |
| LinkedHelper | `https://lh.passionate.agency/mcp` | 75 tools (campaigns, messaging, profiles, feed, search) |
| Media Extract | `https://media.passionate.agency/mcp` | video_info, extract_transcript, download_video, download_audio, list_downloads |

**media-extract config** — to change storage path, quality, or format: edit `C:\Users\user\pm2\media-extract.config.cjs` env block, then `pm2 restart media-extract-mcp && pm2 save`. No code edits needed.
- `MEDIA_ROOT` — storage root (default `D:\media`)
- `MAX_HEIGHT` — video resolution cap (default `720`)
- `VIDEO_FORMAT` / `AUDIO_FORMAT` / `AUDIO_QUALITY` — output formats

**If Cowork shows stale tool schemas:**
- Disconnect the connector in Cowork Settings → Connectors, then reconnect
- This forces Cowork to re-fetch the tool list from the MCP endpoint

---

## Adding New MCPs (standard pattern)

Every new MCP follows this same 6-step pattern. Ports increment from 6004 upward; subdomains follow `<service>.passionate.agency`.

### Install location — two tiers, pick the right one

| Type | Location | Example |
|---|---|---|
| Published npm package | `%APPDATA%\npm\node_modules\<pkg>\` | lhremote, n8n-mcp, supergateway |
| Standalone binary or custom code | `C:\tools\` | yt-dlp.exe, ffmpeg.exe, media-mcp\ |

Use `npm install -g` for npm packages. For binaries or custom Node.js servers you write yourself, put them in `C:\tools\`.

### Step 1 — Install
**If it's an npm package:**
```powershell
npm install -g <package-name>
# Script path will be: $env:APPDATA\npm\node_modules\<package>\dist\<entry>.js
```
**If it's a standalone binary or custom code:**
```powershell
New-Item -ItemType Directory -Force -Path "C:\tools\<service>"
# Download binary or write your Node.js server to C:\tools\<service>\index.js
# Install dependencies: cd C:\tools\<service> && npm install
```

### Step 2 — Create PM2 ecosystem file
Create `C:\Users\user\pm2\<service-name>.config.cjs`:

**npm-package variant** (e.g. linkedhelper pattern):
```js
const npmModules = process.env.APPDATA + '\\npm\\node_modules';
module.exports = {
  apps: [{
    name: '<service-name>-mcp',
    script: npmModules + '\\supergateway\\dist\\index.js',
    interpreter: 'node',
    args: [
      '--stdio', 'node ' + npmModules + '\\<package>\\dist\\<entry>.js mcp',
      '--port', '<PORT>',          // next free port: 6004, 6005, ...
      '--outputTransport', 'streamableHttp',
      '--stateful',
      '--logLevel', 'info',
    ],
    autorestart: true, watch: false, max_restarts: 10, restart_delay: 5000, env: {},
  }],
};
```
**C:\tools variant** (e.g. media-extract pattern):
```js
const npmModules = process.env.APPDATA + '\\npm\\node_modules';
module.exports = {
  apps: [{
    name: '<service-name>-mcp',
    script: npmModules + '\\supergateway\\dist\\index.js',
    interpreter: 'node',
    args: [
      '--stdio', 'node C:\\tools\\<service>\\index.js',
      '--port', '<PORT>',
      '--outputTransport', 'streamableHttp',
      '--stateful',
      '--logLevel', 'info',
    ],
    autorestart: true, watch: false, max_restarts: 10, restart_delay: 5000,
    env: { /* config vars here — avoids hardcoding in source */ },
  }],
};
```
If the MCP already has its own HTTP server (not stdio), skip supergateway — just point PM2 at the binary directly.

### Step 3 — Start PM2 and save
```powershell
pm2 start "C:\Users\user\pm2\<service-name>.config.cjs"
pm2 save   # always save after any PM2 change
pm2 list   # verify status=online, restarts=0
```

### Step 4 — Add Cloudflare ingress rule (requires admin terminal)
```powershell
# In admin PowerShell:
$f = "C:\Windows\System32\config\systemprofile\.cloudflared\config.yml"
# Read current content, add new hostname BEFORE the api.passionate.agency rule:
#   - hostname: <service>.passionate.agency
#     service: http://localhost:<PORT>
# Write back using here-string (@'...'@), then:
sc.exe stop cloudflared; Start-Sleep 2; sc.exe start cloudflared
```
⚠️ The REAL config is at the SYSTEM path above. `~/.cloudflared/config.yml` is a reference copy only — cloudflared does NOT read it.

### Step 5 — Add Cloudflare DNS record
In Cloudflare Dashboard → DNS → Add record:
- Type: CNAME | Name: `<service>` | Target: `30618ade-6269-438c-b28a-3fca6b8d297b.cfargotunnel.com` | Proxied ✅

### Step 6 — Wire Claude Code + Cowork

All connectors use the **cloud connector** mechanism (`claude.ai` scope). Do NOT edit `~/.claude.json` for this — the ConvertFrom-Json round-trip destroys other entries.

**In Cowork → Settings → Connectors → Add:**
```
https://<service>.passionate.agency/mcp
```
This single step makes the connector available in both Cowork AND Claude Code (shows as `claude.ai <service>` in `claude mcp list`).

Verify after adding:
```powershell
claude mcp list   # should show: claude.ai <service>: https://<service>.passionate.agency/mcp - ✓ Connected
```

---

## Update Strategy

Full verified procedures with exact commands: **`C:\Users\user\MAINTENANCE.md`**

Quick audit:
```powershell
npm outdated -g
& "C:\tools\yt-dlp.exe" --version
pm2 list
```

**Automate** (n8n weekly workflow): yt-dlp `-U`, claude-code/n8n-mcp/mcp-remote npm patches, media-mcp deps, email alert for n8n/cloudflared updates.

**Manual only**: n8n (`pm2 stop n8n && npm install -g n8n@latest && pm2 start n8n --update-env && pm2 save`), cloudflared (admin PS, replace exe at `C:\Program Files (x86)\cloudflared\`), Node.js (installer from nodejs.org).

---

## Remaining Build Tasks (sales automation)

These are the actual automation flows yet to be built:

1. **Facebook Lead Ads → n8n webhook** — capture new leads
2. **Lead enrichment** — Apollo or HubSpot lookup
3. **Retell AI voice call** — trigger outbound call to lead
4. **SendGrid email** — follow-up sequence
5. **HubSpot CRM** — create/update contact and deal
6. **Cowork plugins** — connect HubSpot, Apollo connectors in Cowork

---

## Quick Reference

| Task | Command / Location |
|---|---|
| Check all services | `pm2 list` |
| Check tunnel status | `sc.exe query cloudflared` |
| Test n8n endpoint | `curl.exe https://api.passionate.agency/healthz` |
| Test LinkedHelper endpoint | `curl.exe -s https://lh.passionate.agency/mcp` |
| Test Media Extract endpoint | `curl.exe -s -o NUL -w "%{http_code}" https://media.passionate.agency/mcp` |
| View n8n logs | `pm2 logs n8n --lines 50` |
| View LinkedHelper MCP logs | `pm2 logs linkedhelper-mcp --lines 50` |
| View Media Extract logs | `pm2 logs media-extract-mcp --lines 50` |
| Restart n8n | `pm2 restart n8n` |
| Restart LinkedHelper MCP | `pm2 restart linkedhelper-mcp` |
| Restart Media Extract MCP | `pm2 restart media-extract-mcp && pm2 save` |
| Change media storage path | Edit `C:\Users\user\pm2\media-extract.config.cjs` MEDIA_ROOT, then restart |
| n8n UI | http://localhost:5678 or https://api.passionate.agency |
| Claude Code config | `~/.claude.json` (never display in full) |
| **Cloudflare tunnel config (REAL)** | `C:\Windows\System32\config\systemprofile\.cloudflared\config.yml` **(admin required)** |
| Cloudflare tunnel config (reference copy) | `~/.cloudflared\config.yml` (NOT read by service — edit SYSTEM path above) |
| PM2 ecosystem files | `C:\Users\user\pm2\` |
| LinkedHelper startup shortcut | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\LinkedHelper.lnk` (verify target points to latest `app-X.X.XX` after updates) |
