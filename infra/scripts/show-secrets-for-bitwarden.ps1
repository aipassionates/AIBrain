# show-secrets-for-bitwarden.ps1
# Prints every secret VALUE to THIS console so you can copy them into Bitwarden.
#
# >>> RUN THIS IN A PLAIN POWERSHELL WINDOW, *NOT* by asking Claude to run it, <<<
# >>> so the secret values never enter a chat transcript.                      <<<
#
# It only READS and DISPLAYS. It never writes secrets to disk.

Write-Host "==== ENV VAR SECRETS (one Bitwarden entry each) ====" -ForegroundColor Cyan
$names = 'N8N_API_KEY','WP_APP_PASS','WP_APP_PASS_PASSIONATES','WP_USER_PASSIONATES','WP_URL_PASSIONATES','CLAUDE_SEO_TOKEN','GMAIL_APP_PASSWORD','SUPABASE_ANON_KEY'
foreach($n in $names){
  $v=[Environment]::GetEnvironmentVariable($n,'User')
  if($v){ "{0,-26} = {1}" -f $n,$v } else { "{0,-26} = (not set as env var)" -f $n }
}

Write-Host "`n==== SUPABASE_ANON_KEY (read from live SEO script) ====" -ForegroundColor Cyan
$m = Select-String -Path 'C:\tools\enrich-ga4.js' -Pattern "ANON_KEY\s*=\s*'(eyJ[^']+)'"
if($m){ "SUPABASE_ANON_KEY        = " + $m.Matches[0].Groups[1].Value } else { "not found - check C:\tools\enrich-ga4.js line ~17" }

Write-Host "`n==== n8n ENCRYPTION KEY (MOST CRITICAL) ====" -ForegroundColor Cyan
$cfg = "$env:USERPROFILE\.n8n\config"
if(Test-Path $cfg){ "N8N_ENCRYPTION_KEY       = " + (Get-Content $cfg -Raw | ConvertFrom-Json).encryptionKey } else { "not found at $cfg" }

Write-Host "`n==== SEO-WEEKLY email password (if configured) ====" -ForegroundColor Cyan
$sw = 'C:\Users\user\pm2\seo-weekly.config.cjs'
if(Test-Path $sw){ Select-String -Path $sw -Pattern 'GMAIL|PASS|MAIL' | ForEach-Object { $_.Line.Trim() } } else { 'seo-weekly config not found' }

Write-Host "`n==== FILE SECRETS (store as Bitwarden file attachments) ====" -ForegroundColor Cyan
'  C:\tools\google-analytics-mcp\credentials.json'
'  C:\tools\google-analytics-mcp\token.json'
'  C:\Windows\System32\config\systemprofile\.cloudflared\30618ade-6269-438c-b28a-3fca6b8d297b.json   (admin to read)'

Write-Host "`nNothing was saved to disk. Copy the above into Bitwarden, then close this window." -ForegroundColor Yellow
