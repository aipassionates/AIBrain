# export-n8n-workflows.ps1
# Exports all n8n workflows to infra/n8n-workflows/ as individual JSON files.
# Run manually or via a scheduled n8n workflow (daily cron recommended).
#
# Usage: .\infra\scripts\export-n8n-workflows.ps1
# Requires: N8N_API_KEY in User env vars

param(
  [string]$OutputDir = "$PSScriptRoot\..\n8n-workflows",
  [string]$ApiUrl    = "https://api.passionate.agency/api/v1"
)

$key = [System.Environment]::GetEnvironmentVariable("N8N_API_KEY", "User")
if (-not $key) { throw "N8N_API_KEY not found in User environment variables." }

$headers = @{ "X-N8N-API-KEY" = $key }

# Fetch all workflows
$response = Invoke-RestMethod -Uri "$ApiUrl/workflows?limit=250" -Headers $headers -Method GET
$workflows = $response.data

if (-not $workflows) {
  Write-Host "No workflows found or API error."
  exit 1
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

# Write each workflow as a separate file named by ID and slug
$count = 0
foreach ($wf in $workflows) {
  $slug = ($wf.name -replace '[^a-zA-Z0-9\-_]', '-').ToLower().Trim('-')
  $filename = "$($wf.id)_$slug.json"
  $wf | ConvertTo-Json -Depth 20 | Set-Content "$OutputDir\$filename" -Encoding utf8
  $count++
}

Write-Host "Exported $count workflows to $OutputDir"

# Optional: git commit if run from repo root
# git -C "$PSScriptRoot\..\.." add infra/n8n-workflows/
# git -C "$PSScriptRoot\..\.." commit -m "chore: export n8n workflows $(Get-Date -Format 'yyyy-MM-dd')"
# git -C "$PSScriptRoot\..\.." push
