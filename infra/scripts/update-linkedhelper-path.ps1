# update-linkedhelper-path.ps1
# Updates all 3 places that hardcode the LinkedHelper versioned exe path.
# Run after LinkedHelper auto-updates to a new app-X.X.XX version.
#
# Usage: .\infra\scripts\update-linkedhelper-path.ps1 -NewVersion "2.114.5"

param(
  [Parameter(Mandatory)][string]$NewVersion
)

$AppData = $env:APPDATA
$LocalAppData = $env:LOCALAPPDATA
$NewExe = "$LocalAppData\linked-helper\app-$NewVersion\linked-helper.exe"

if (-not (Test-Path $NewExe)) {
  throw "Exe not found at $NewExe — verify the new version number."
}

Write-Host "Updating LinkedHelper path to: $NewExe"

# ── 1. Startup shortcut ───────────────────────────────────────────────────────
$ShortcutPath = "$AppData\Microsoft\Windows\Start Menu\Programs\Startup\LinkedHelper.lnk"
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $NewExe
$Shortcut.Arguments = "--remote-debugging-port=9222"
$Shortcut.Save()
Write-Host "  ✓ Startup shortcut updated"

# ── 2. PM2 ecosystem config ───────────────────────────────────────────────────
$RepoConfig = "C:\Users\user\passionate-agency\infra\pm2\linkedhelper-mcp.config.cjs"
$LiveConfig  = "C:\Users\user\pm2\linkedhelper-mcp.config.cjs"

foreach ($cfg in @($RepoConfig, $LiveConfig)) {
  $content = Get-Content $cfg -Raw
  $updated = $content -replace "app-[\d.]+\\\\linked-helper\.exe", "app-$NewVersion\\linked-helper.exe"
  Set-Content $cfg $updated -Encoding utf8
  Write-Host "  ✓ Updated $cfg"
}

# ── 3. ~/.claude.json ─────────────────────────────────────────────────────────
$cfgPath = "$env:USERPROFILE\.claude.json"
$raw = Get-Content $cfgPath -Raw
$updated = $raw -replace "app-[\d.]+\\\\linked-helper\.exe", "app-$NewVersion\\linked-helper.exe"
Set-Content $cfgPath $updated -Encoding utf8
Write-Host "  ✓ ~/.claude.json updated"

# ── 4. Restart PM2 service ────────────────────────────────────────────────────
pm2 restart linkedhelper-mcp
pm2 save
Write-Host "  ✓ PM2 restarted"

Write-Host "`nDone. Verify: pm2 logs linkedhelper-mcp --lines 20"
Write-Host "Also: open LinkedHelper → start accounts if needed"
