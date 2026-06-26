---
name: update-linkedhelper-version
description: Update LinkedHelper after an app auto-update by fixing the 3 stale paths (startup shortcut, PM2 config, ~/.claude.json).
---

# Skill: Update LinkedHelper Version

After LinkedHelper auto-updates to a new `app-X.X.XX` folder, three paths must be updated.
Use the automation script, or follow the manual steps below.

---

## Automated (recommended)

```powershell
.\infra\scripts\update-linkedhelper-path.ps1 -NewVersion "2.115.0"
```

The script updates all 3 locations and restarts PM2.

---

## Manual steps

### Why 3 places?

The versioned exe path `app-X.X.XX\linked-helper.exe` is hardcoded in three independent places.
LinkedHelper's Squirrel launcher (`linked-helper.exe` in the root) exits immediately after
spawning the real app — CDP (`--remote-debugging-port=9222`) must be passed to the VERSIONED exe.

### Find the new version

```powershell
Get-ChildItem "$env:LOCALAPPDATA\linked-helper" -Directory | Where Name -like "app-*" | Sort LastWriteTime -Desc
```

### 1. Startup shortcut

Target: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\LinkedHelper.lnk`
- Right-click → Properties → Target → update `app-X.X.XX` → Apply

### 2. PM2 ecosystem config

Edit `infra/pm2/linkedhelper-mcp.config.cjs` (and `C:\Users\user\pm2\linkedhelper-mcp.config.cjs`):
```
LINKEDHELPER_PATH: 'C:\\Users\\user\\AppData\\Local\\linked-helper\\app-<NEW>\\linked-helper.exe',
```

Then restart PM2:
```powershell
pm2 restart linkedhelper-mcp && pm2 save
```

### 3. ~/.claude.json

Raw string replace (NOT ConvertFrom-Json round-trip to avoid wiping mcpServers):
```powershell
$raw = Get-Content "$env:USERPROFILE\.claude.json" -Raw
$raw = $raw -replace "app-[\d.]+\\\\linked-helper\.exe", "app-<NEW>\\linked-helper.exe"
Set-Content "$env:USERPROFILE\.claude.json" $raw -Encoding utf8
```

### Verify

```powershell
pm2 logs linkedhelper-mcp --lines 20  # should show connection to CDP port 9222
# In Claude Code: use the launch-app tool or check-status tool
```
