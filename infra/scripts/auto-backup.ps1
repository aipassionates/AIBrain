# auto-backup.ps1 — nightly commit + push of the AIBrain repo, with a secret-scan guard.
# Registered as Scheduled Task "AIBrain Auto Backup" (daily). Safe to run manually too.
$ErrorActionPreference = 'SilentlyContinue'
$repo = 'C:\Users\user\AIBrain'
$log  = Join-Path $repo 'infra\scripts\auto-backup.log'
$env:GIT_TERMINAL_PROMPT = '0'; $env:GCM_INTERACTIVE = 'never'
function Log($m){ "$(Get-Date -Format 'yyyy-MM-dd HH:mm') $m" | Add-Content $log }

git -C $repo add -A
$status = git -C $repo status --porcelain
if (-not $status) { Log 'no changes'; exit 0 }

# Secret guard: block commit if a high-confidence secret is staged
$staged = git -C $repo diff --cached --name-only
$rx = 'eyJ[A-Za-z0-9_-]{10,}\.eyJ|sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----'
$leak = $false
foreach ($rel in $staged) {
  $p = Join-Path $repo $rel
  if (Test-Path $p) { if (Select-String -Path $p -Pattern $rx -Quiet) { Log "BLOCKED: possible secret in $rel"; $leak = $true } }
}
if ($leak) { git -C $repo reset | Out-Null; Log 'aborted — secret detected, nothing committed'; exit 2 }

git -C $repo commit -q -m "chore: auto-backup $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
$push = git -C $repo push 2>&1
if ($LASTEXITCODE -eq 0) { Log 'committed + pushed OK' } else { Log "committed locally; push failed: $push" }
