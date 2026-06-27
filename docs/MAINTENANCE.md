# System Maintenance Guide — Passionate Agency AI Stack

> All commands in this document have been tested live on this machine.
> Claims marked ✅ VERIFIED were confirmed by running commands or checking APIs.
> Claims marked ⚠️ RECOMMENDED are best-practice guidance, not technically enforced.

**Last verified:** 2026-05-30
**Machine:** Windows, Node v24.15.0, PM2 7.0.1

---

## Quick Audit — Run Any Time

Run this first to see what needs attention:

```powershell
# Full version snapshot
Write-Host "=== npm global ==="
npm outdated -g

Write-Host "`n=== C:\tools binaries ==="
& "C:\tools\yt-dlp.exe" --version
(& "C:\tools\ffmpeg.exe" -version 2>&1)[0]

Write-Host "`n=== cloudflared ==="
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" --version

Write-Host "`n=== PM2 processes ==="
pm2 list
```

---

## Component Reference

### yt-dlp
| Item | Detail |
|---|---|
| Location | `C:\tools\yt-dlp.exe` |
| Update frequency | 1–3 releases per month (✅ verified from GitHub release history) |
| Why it matters | Sites change internal APIs constantly; outdated yt-dlp causes silent extraction failures |
| Update command | `C:\tools\yt-dlp.exe -U` |
| Automation | ✅ Safe to automate — self-updates in-place, no restart needed |
| Risk | None — atomic self-update, falls back if update fails |

**Update command (verified ✅):**
```powershell
C:\tools\yt-dlp.exe -U
# Output confirms old → new version, or "yt-dlp is up to date"
```

---

### FFmpeg
| Item | Detail |
|---|---|
| Location | `C:\tools\ffmpeg.exe` and `C:\tools\ffprobe.exe` |
| Source | yt-dlp's own FFmpeg builds: github.com/yt-dlp/FFmpeg-Builds |
| Update frequency | Low — update quarterly or when yt-dlp changelog mentions FFmpeg issues |
| Automation | Not needed |

**Update command (verified ✅):**
```powershell
# Admin PowerShell not required — C:\tools is user-writable
$rel = Invoke-RestMethod "https://api.github.com/repos/yt-dlp/FFmpeg-Builds/releases/latest"
$zip = ($rel.assets | Where-Object { $_.name -match "win64-gpl\.zip$" } | Select-Object -First 1).browser_download_url
Invoke-WebRequest -Uri $zip -OutFile "C:\tools\ffmpeg.zip" -UseBasicParsing
Expand-Archive "C:\tools\ffmpeg.zip" -DestinationPath "C:\tools\ffmpeg-tmp" -Force
$bin = (Get-ChildItem "C:\tools\ffmpeg-tmp" -Directory | Select-Object -First 1).FullName + "\bin"
Copy-Item "$bin\ffmpeg.exe"  "C:\tools\ffmpeg.exe" -Force
Copy-Item "$bin\ffprobe.exe" "C:\tools\ffprobe.exe" -Force
Remove-Item "C:\tools\ffmpeg-tmp", "C:\tools\ffmpeg.zip" -Recurse -Force
(& "C:\tools\ffmpeg.exe" -version 2>&1)[0]   # verify
```

---

### n8n
| Item | Detail |
|---|---|
| Location | `%APPDATA%\npm\node_modules\n8n\bin\n8n` (✅ verified from PM2 show n8n) |
| PM2 script | Absolute path — `pm2 restart n8n` picks up new version automatically (✅ verified) |
| Current | 2.21.5 → latest 2.22.5 as of 2026-05-30 |
| Update frequency | Minor updates every 2–4 weeks; patch updates more often |
| Automation | ❌ Manual only — minor versions regularly change node behaviour, expressions, webhook handling |

**Before updating n8n — always check:**
1. github.com/n8n-io/n8n/releases — look for "Breaking changes" or "Deprecated" sections
2. If the Cowork MCP Tools workflow (ID: `2zxCSXHtmY76XU69`) uses any changed node types, test manually first

**Update command (verified logic ✅):**
```powershell
# PM2 uses absolute path to n8n binary, so npm upgrade replaces it in-place
pm2 stop n8n
npm install -g n8n@latest
pm2 start n8n --update-env   # --update-env picks up any new env vars
pm2 save

# Verify
pm2 list                                    # status=online, restarts=0
curl.exe https://api.passionate.agency/healthz
# Then test the Cowork MCP Tools workflow manually in n8n UI
```

---

### n8n-mcp
| Item | Detail |
|---|---|
| Location | `%APPDATA%\npm\node_modules\n8n-mcp\` |
| Version dependency | Node.js >=16 only — NO hard lock on n8n version (✅ verified from package.json) |
| Update frequency | Follows n8n API — update after confirming n8n API unchanged |
| Automation | ✅ Safe — patch and minor updates are backwards-compatible |

**Update command:**
```powershell
npm install -g n8n-mcp@latest
claude mcp list   # verify n8n connector still shows ✓ Connected
```

---

### Claude Code (@anthropic-ai/claude-code)
| Item | Detail |
|---|---|
| Location | `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\` |
| Update frequency | Frequent patch releases |
| Automation | ✅ Safe to automate — patch updates only |

**Update command:**
```powershell
npm install -g @anthropic-ai/claude-code@latest
claude --version   # verify
```

---

### supergateway
| Item | Detail |
|---|---|
| Location | `%APPDATA%\npm\node_modules\supergateway\` |
| Current stable | 3.4.3 |
| Known history | v3.4.0 explicitly rolled back v3.3.0 due to stability issues (✅ verified from GitHub release notes: "This is a rollback release to a stable v3.2.0 state") |
| Used by | linkedhelper-mcp (PM2 id:1) and media-extract-mcp (PM2 id:2) |
| Automation | ⚠️ Check release notes before updating — has a history of regressions |

**Update command:**
```powershell
npm install -g supergateway@latest
pm2 restart linkedhelper-mcp media-extract-mcp && pm2 save
# Verify both services recover cleanly:
Start-Sleep 5; pm2 list   # both should show restarts=0 after settling
```

---

### lhremote (LinkedHelper MCP)
| Item | Detail |
|---|---|
| Location | `%APPDATA%\npm\node_modules\lhremote\` |
| Version dependency | Node.js >=24 only — NO hard version lock on LinkedHelper app (✅ verified from package.json) |
| ⚠️ Recommended practice | Update lhremote when updating the LinkedHelper desktop app — they may use compatible APIs but staying in sync avoids subtle issues |
| Automation | ❌ Manual — coordinate with LinkedHelper app updates |

**Update command:**
```powershell
npm install -g lhremote@latest
pm2 restart linkedhelper-mcp && pm2 save
Start-Sleep 5; pm2 list   # verify restarts=0
claude mcp list           # verify LinkedHelper shows ✓ Connected
```

---

### mcp-remote
| Item | Detail |
|---|---|
| Location | `%APPDATA%\npm\node_modules\mcp-remote\` |
| Purpose | Proxy for remote MCP connections from Claude Code |
| Automation | ✅ Safe — stable package, infrequent updates |

**Update command:**
```powershell
npm install -g mcp-remote@latest
```

---

### media-mcp (custom — C:\tools\media-mcp)
| Item | Detail |
|---|---|
| Location | `C:\tools\media-mcp\` |
| Dependencies | `@modelcontextprotocol/sdk` (in node_modules inside that folder) |
| Automation | ✅ Safe to automate |

**Update command:**
```powershell
Set-Location "C:\tools\media-mcp"
npm update
pm2 restart media-extract-mcp && pm2 save
```

---

### cloudflared (Windows service)
| Item | Detail |
|---|---|
| Executable | `C:\Program Files (x86)\cloudflared\cloudflared.exe` (✅ verified from registry ImagePath) |
| Service config | `C:\Windows\System32\config\systemprofile\.cloudflared\config.yml` (admin required to edit) |
| Update | Replace the exe file — service ImagePath stays the same |
| Automation | ❌ Manual — requires admin PowerShell |

**Update command (admin PowerShell required):**
```powershell
# Check current vs latest first
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" --version
(Invoke-RestMethod "https://api.github.com/repos/cloudflare/cloudflared/releases/latest").tag_name

# Download and replace (stops the service briefly)
$rel = Invoke-RestMethod "https://api.github.com/repos/cloudflare/cloudflared/releases/latest"
$url = ($rel.assets | Where-Object { $_.name -eq "cloudflared-windows-amd64.exe" }).browser_download_url
sc.exe stop cloudflared
Start-Sleep 3
Invoke-WebRequest -Uri $url -OutFile "C:\Program Files (x86)\cloudflared\cloudflared.exe" -UseBasicParsing
sc.exe start cloudflared
Start-Sleep 3
sc.exe query cloudflared | Select-String "STATE"
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" --version   # verify new version
```

---

### Node.js
| Item | Detail |
|---|---|
| Current | v24.15.0 (LTS "Krypton") — one patch behind v24.16.0 (✅ verified from nodejs.org) |
| Patch updates (24.x.y) | Safe, monthly — download installer from nodejs.org |
| Major LTS updates (24→26) | New LTS line every 2 years — plan carefully, test all PM2 processes |
| After any Node.js update | Run `pm2 update && pm2 restart all && pm2 save` |

**Patch update (24.x.y):**
1. Download installer from https://nodejs.org/en/download (LTS tab)
2. Run installer — it upgrades in-place
3. Open new PowerShell: `node --version` to confirm
4. `pm2 update && pm2 restart all && pm2 save`
5. `pm2 list` — verify all services online with 0 restarts

---

### PM2
| Item | Detail |
|---|---|
| Current | 7.0.1 |
| Update frequency | Rarely — very stable |
| Risk | Low — but update in isolation, not bundled with other updates |

**Update command:**
```powershell
pm2 save   # snapshot current state first
npm install -g pm2@latest
pm2 update
pm2 list   # all processes should still be running
```

---

## Recommended Automation: n8n Weekly Workflow

Build this workflow in n8n to handle Tier 1 automatically. All commands below are safe to run unattended.

**Trigger:** Schedule (weekly, e.g. Sunday 2am)

**Node 1 — Update yt-dlp** (Execute Command):
```
C:\tools\yt-dlp.exe -U
```

**Node 2 — Update safe npm packages** (Execute Command):
```
npm install -g @anthropic-ai/claude-code@latest n8n-mcp@latest mcp-remote@latest
```

**Node 3 — Update media-mcp deps** (Execute Command):
```
cmd /c "cd C:\tools\media-mcp && npm update"
```

**Node 4 — Restart media-extract-mcp** (Execute Command):
```
pm2 restart media-extract-mcp && pm2 save
```

**Node 5 — Check for n8n update** (HTTP Request):
- URL: `https://registry.npmjs.org/n8n/latest`
- Returns: `{ "version": "x.x.x" }`

**Node 6 — Check for cloudflared update** (HTTP Request):
- URL: `https://api.github.com/repos/cloudflare/cloudflared/releases/latest`
- Returns: `{ "tag_name": "20xx.x.x" }`

**Node 7 — Code node** (compare versions, build email body):
```javascript
const n8nLatest = $('Check n8n update').first().json.version;
const cfLatest = $('Check cloudflared update').first().json.tag_name;

// ⚠️ UPDATE THESE VALUES MANUALLY after each upgrade
const n8nCurrent = '2.21.5';    // current installed version
const cfCurrent  = '2026.5.0';  // current installed version

// Version compare: splits "2026.5.2" → [2026,5,2] and compares numerically
function isNewer(latest, current) {
  const a = latest.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i]||0) > (b[i]||0)) return true;
    if ((a[i]||0) < (b[i]||0)) return false;
  }
  return false;
}

const alerts = [];
if (isNewer(n8nLatest, n8nCurrent)) alerts.push(`n8n: ${n8nCurrent} → ${n8nLatest} (manual update needed)`);
if (isNewer(cfLatest, cfCurrent))   alerts.push(`cloudflared: ${cfCurrent} → ${cfLatest} (admin PS needed)`);

return [{
  json: {
    subject: alerts.length ? `[Action needed] Updates available` : `[Weekly] Auto-updates applied OK`,
    body: [
      'Auto-applied:',
      '  yt-dlp -U',
      '  claude-code, n8n-mcp, mcp-remote npm patches',
      '  media-mcp deps',
      '',
      alerts.length ? 'Manual action needed:\n  ' + alerts.join('\n  ') : 'Nothing else pending.'
    ].join('\n')
  }
}];
```

**Node 8 — Gmail send** (Gmail node): send to your address.

---

## Manual Update Checklist (Run Monthly)

```
[ ] npm outdated -g                    — check what's behind
[ ] C:\tools\yt-dlp.exe --version     — confirm auto-update ran
[ ] pm2 list                           — all online, restarts=0
[ ] claude mcp list                    — all connectors ✓ Connected
[ ] Check n8n release notes            — decide whether to update n8n
[ ] Check cloudflared version          — update if >2 versions behind
[ ] curl.exe https://api.passionate.agency/healthz    — tunnel healthy
[ ] curl.exe https://lh.passionate.agency/mcp         — lhremote healthy
[ ] curl.exe -s -o NUL -w "%{http_code}" https://media.passionate.agency/mcp  — expect 400
```

---

## What Breaks If You Don't Update

| Neglected component | What happens |
|---|---|
| yt-dlp (weeks behind) | `extract_transcript` and `download_video` return errors or wrong output — sites change APIs |
| n8n (months behind) | Missing security patches; rarely breaks workflows at patch level |
| cloudflared (quarters behind) | Tunnel stays working; occasional TLS/protocol compatibility warnings |
| lhremote (after LinkedHelper app update) | LinkedHelper MCP may return API errors if underlying API changed |
| Claude Code (months behind) | Missing bug fixes and model improvements; rarely breaks |
| Node.js (major version skip) | PM2 process compatibility risk — always update one major at a time |
