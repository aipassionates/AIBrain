# restore-machine.ps1
# Full stack restore on a new Windows machine.
# Read infra/runbook.md FIRST — this script covers software, not accounts/credentials.
#
# Prerequisites before running:
#   - Windows 11
#   - Node.js LTS installed (nodejs.org) — check MAINTENANCE.md for version
#   - Git installed
#   - Clone this repo: git clone <repo-url> C:\Users\user\passionate-agency
#   - Cloudflare tunnel credentials JSON in password manager (see infra/cloudflared/README.md)
#   - .env populated from .env.example
#   - Google credentials.json downloaded from Google Cloud Console
#
# Usage: .\infra\scripts\restore-machine.ps1

$RepoRoot = "C:\Users\user\passionate-agency"
$ErrorActionPreference = "Stop"

Write-Host "=== Passionate Agency Stack Restore ===" -ForegroundColor Cyan

# ── 1. npm global packages ────────────────────────────────────────────────────
Write-Host "`n[1/7] Installing npm global packages..."
npm install -g pm2 n8n@latest supergateway lhremote n8n-mcp
pm2 install pm2-windows-startup

# ── 2. C:\tools binaries ─────────────────────────────────────────────────────
Write-Host "`n[2/7] Restoring C:\tools binaries..."
New-Item -ItemType Directory -Force -Path "C:\tools" | Out-Null
# yt-dlp (self-updates, just get latest)
Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" `
  -OutFile "C:\tools\yt-dlp.exe"
# ffmpeg: download from https://github.com/yt-dlp/FFmpeg-Builds/releases (manual)
Write-Warning "FFmpeg: download yt-dlp FFmpeg build manually → C:\tools\ffmpeg.exe"

# ── 3. MCP server dependencies ────────────────────────────────────────────────
Write-Host "`n[3/7] Installing MCP server dependencies..."
Push-Location "$RepoRoot\mcp-servers\media-mcp"; npm install; Pop-Location
Push-Location "$RepoRoot\mcp-servers\google-analytics-mcp"; npm install; Pop-Location
Write-Warning "Google Analytics: copy credentials.json to mcp-servers\google-analytics-mcp\, then run: node auth.js"

# ── 4. PM2 ecosystem ──────────────────────────────────────────────────────────
Write-Host "`n[4/7] Starting PM2 services..."
New-Item -ItemType Directory -Force -Path "D:\media\downloads" | Out-Null
New-Item -ItemType Directory -Force -Path "D:\media\transcripts" | Out-Null
New-Item -ItemType Directory -Force -Path "D:\media\audio" | Out-Null

# n8n — start first, configure, then start MCPs
pm2 start n8n --name n8n -- start --tunnel
pm2 start "$RepoRoot\infra\pm2\linkedhelper-mcp.config.cjs"
pm2 start "$RepoRoot\infra\pm2\media-extract.config.cjs"
pm2 start "$RepoRoot\infra\pm2\google-analytics-mcp.config.cjs"
pm2 save
pm2-startup install  # registers PM2 auto-start via Task Scheduler

# ── 5. n8n API key ────────────────────────────────────────────────────────────
Write-Host "`n[5/7] n8n API key..."
Write-Warning "Manual step: open http://localhost:5678 → Settings → API → generate key"
Write-Warning "Then run: [Environment]::SetEnvironmentVariable('N8N_API_KEY', '<key>', 'User')"
Write-Warning "Then restore ~/.claude.json using CLAUDE.md recovery script"

# ── 6. Cloudflare tunnel ─────────────────────────────────────────────────────
Write-Host "`n[6/7] Cloudflare tunnel..."
Write-Warning "Manual (admin PS): install cloudflared service, copy config.yml from infra/cloudflared/README.md"

# ── 7. LinkedHelper ───────────────────────────────────────────────────────────
Write-Host "`n[7/7] LinkedHelper..."
Write-Warning "Manual: install LinkedHelper, log into LinkedIn, update startup shortcut target to new app-X.X.XX path"
Write-Warning "Update LINKEDHELPER_PATH in infra/pm2/linkedhelper-mcp.config.cjs"

Write-Host "`n=== Restore script complete ===" -ForegroundColor Green
Write-Host "Manual steps above still needed. See infra/runbook.md for detail."
