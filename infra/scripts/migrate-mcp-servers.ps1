# migrate-mcp-servers.ps1
# ONE-TIME: Moves custom MCP source code from C:\tools\ into the repo's mcp-servers/
# and updates PM2 to use the new paths.
#
# Run ONCE from repo root (C:\Users\user\passionate-agency\):
#   .\infra\scripts\migrate-mcp-servers.ps1
#
# After running, the canonical source is in mcp-servers/ and C:\tools\<name>\ can be
# archived or deleted (keep yt-dlp.exe and ffmpeg.exe — they stay in C:\tools\).

$RepoRoot = "C:\Users\user\passionate-agency"
$TargetBase = "$RepoRoot\mcp-servers"

Write-Host "=== Migrating MCP server source to repo ==="

# 1. Copy source files (exclude node_modules and OAuth secrets)
$services = @(
  @{ Src = "C:\tools\media-mcp";          Dst = "$TargetBase\media-mcp" },
  @{ Src = "C:\tools\google-analytics-mcp"; Dst = "$TargetBase\google-analytics-mcp" }
)

foreach ($svc in $services) {
  if (-not (Test-Path $svc.Src)) { Write-Warning "Source not found: $($svc.Src)"; continue }
  Write-Host "Copying $($svc.Src) → $($svc.Dst)"
  robocopy $svc.Src $svc.Dst /E /XD node_modules /XF token.json credentials.json *.log | Out-Null
  # Install dependencies at new location
  Push-Location $svc.Dst
  npm install --silent
  Pop-Location
  Write-Host "  ✓ npm install done"
}

# 2. Update PM2 configs to point to new paths
Write-Host "`n=== Updating PM2 to use new paths ==="

$pm2Configs = @(
  @{
    Name    = "media-extract-mcp"
    Config  = "$RepoRoot\infra\pm2\media-extract.config.cjs"
    OldPath = "C:\\\\tools\\\\media-mcp\\\\index.js"
    NewPath = "$($RepoRoot.Replace('\','\\'))\\\\mcp-servers\\\\media-mcp\\\\index.js"
  },
  @{
    Name    = "google-analytics-mcp"
    Config  = "$RepoRoot\infra\pm2\google-analytics-mcp.config.cjs"
    OldPath = "C:\\\\tools\\\\google-analytics-mcp\\\\index.js"
    NewPath = "$($RepoRoot.Replace('\','\\'))\\\\mcp-servers\\\\google-analytics-mcp\\\\index.js"
  }
)

foreach ($cfg in $pm2Configs) {
  $content = Get-Content $cfg.Config -Raw
  $updated = $content -replace [regex]::Escape("C:\\tools\\$($cfg.Name -replace '-mcp','')\\index.js"),
             "$RepoRoot\mcp-servers\$($cfg.Name -replace '-mcp','')\" + "index.js"
  # Write the updated config back (the live C:\Users\user\pm2\ copy too)
  Set-Content $cfg.Config $updated -Encoding utf8
  Copy-Item $cfg.Config "C:\Users\user\pm2\$(Split-Path $cfg.Config -Leaf)" -Force

  # Restart PM2 with new config
  pm2 delete $cfg.Name 2>$null
  pm2 start $cfg.Config
}

pm2 save
Write-Host "`n=== Migration complete ==="
Write-Host "Verify: pm2 list"
Write-Host "Test media-extract: check https://media.passionate.agency/mcp responds"
Write-Host "Test google-analytics: check https://analytics.passionate.agency/mcp responds"
Write-Host "`nThe C:\tools\media-mcp\ and C:\tools\google-analytics-mcp\ directories"
Write-Host "can now be archived (keep C:\tools\yt-dlp.exe and ffmpeg.exe)."
