# Skill: Restore Full Stack on New Machine

For the automated portions, run `infra/scripts/restore-machine.ps1`.
This skill covers everything the script can't do (accounts, secrets, OAuth).

---

## Before you start — gather these from password manager

- n8n API key (regenerated fresh in step 5)
- Cloudflare tunnel credentials JSON (`30618ade-....json`)
- Google OAuth `credentials.json` (from Google Cloud Console)
- All API keys listed in `.env.example`

---

## Restore order matters

### 1. Base software

Install in this order (each depends on the previous):
1. Node.js LTS — check `MAINTENANCE.md` for the version the stack was running
2. Git
3. Clone repo: `git clone <repo-url> C:\Users\user\passionate-agency`

### 2. npm globals

```powershell
npm install -g pm2 n8n@latest supergateway lhremote n8n-mcp
pm2 install pm2-windows-startup
```

Check `MAINTENANCE.md` for pinned versions if any packages had breaking changes.

### 3. C:\tools binaries

```powershell
New-Item -ItemType Directory -Force C:\tools
# yt-dlp: latest release
Invoke-WebRequest "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile C:\tools\yt-dlp.exe
# ffmpeg: download from https://github.com/yt-dlp/FFmpeg-Builds/releases manually
```

### 4. MCP server dependencies

```powershell
cd C:\Users\user\passionate-agency\mcp-servers\media-mcp; npm install
cd C:\Users\user\passionate-agency\mcp-servers\google-analytics-mcp; npm install
```

Copy `credentials.json` from password manager → `mcp-servers/google-analytics-mcp/credentials.json`
Then run: `node mcp-servers/google-analytics-mcp/auth.js` (browser OAuth, saves token.json)

### 5. n8n

```powershell
pm2 start n8n --name n8n
```
Open http://localhost:5678 → create admin account → Settings → API → generate key.

```powershell
[Environment]::SetEnvironmentVariable("N8N_API_KEY", "<key>", "User")
```

Set n8n Machine env vars (required for webhook URLs):
```powershell
[Environment]::SetEnvironmentVariable("N8N_HOST", "api.passionate.agency", "Machine")
[Environment]::SetEnvironmentVariable("N8N_PROTOCOL", "https", "Machine")
[Environment]::SetEnvironmentVariable("N8N_PORT", "5678", "Machine")
[Environment]::SetEnvironmentVariable("WEBHOOK_URL", "https://api.passionate.agency/", "Machine")
```
Restart n8n after setting Machine vars: `pm2 restart n8n`

Import workflows: n8n UI → Workflows → Import → select files from `infra/n8n-workflows/`
Restore credentials in n8n Credential store (values from password manager).

### 6. PM2 MCP services

```powershell
# Copy PM2 configs to live location
Copy-Item C:\Users\user\passionate-agency\infra\pm2\* C:\Users\user\pm2\ -Force

pm2 start C:\Users\user\pm2\linkedhelper-mcp.config.cjs
pm2 start C:\Users\user\pm2\media-extract.config.cjs
pm2 start C:\Users\user\pm2\google-analytics-mcp.config.cjs
pm2 save
```

### 7. Cloudflare tunnel (admin PowerShell)

```powershell
# Install cloudflared
# Copy config.yml (from infra/cloudflared/README.md) to SYSTEM path
# Copy tunnel credentials JSON from password manager to SYSTEM path
cloudflared service install
sc.exe start cloudflared
```

### 8. LinkedHelper

Install LinkedHelper desktop app → log in to LinkedIn accounts → configure startup shortcut
(see `skills/update-linkedhelper-version.md` for the shortcut + PM2 config update).

### 9. ~/.claude.json

Run the recovery script from `skills/restore-claude-json.md` for n8n-local-builder.
Cloud connectors (lh, media, analytics, cowork) reconnect via Cowork Settings → Connectors.

### 10. Verification

```powershell
pm2 list                                                            # all online
curl.exe https://api.passionate.agency/healthz                     # 200
curl.exe -s -o NUL -w "%{http_code}" https://lh.passionate.agency/mcp      # 200/405
curl.exe -s -o NUL -w "%{http_code}" https://media.passionate.agency/mcp   # 200/405
curl.exe -s -o NUL -w "%{http_code}" https://analytics.passionate.agency/mcp # 200/405
claude mcp list                                                     # all ✓ Connected
```

---

## What can't be restored from git

| Item | Recovery |
|---|---|
| n8n credential values | Password manager |
| n8n encryption key | Password manager (set `N8N_ENCRYPTION_KEY` env var before first run, or recover from old DB) |
| Cloudflare tunnel credentials JSON | Password manager |
| Google OAuth token.json | Re-run `auth.js` (token refreshes automatically after) |
| Google credentials.json | Google Cloud Console → OAuth 2.0 Client → download |
| LinkedIn session | Log in to LinkedHelper |
| All API keys (Retell, SendGrid, etc.) | Respective dashboards + password manager |
