# Skill: Rotate n8n API Key

Four locations must be updated in order. If any is missed, that component breaks.

---

## Step 1 — Revoke old key and generate new one

n8n UI → Settings → API → revoke old key → Create API key → copy it immediately.

## Step 2 — Update n8n Credential store

n8n UI → Settings → Credentials → find the `httpHeaderAuth` credential used by the Cowork MCP Tools workflow → update the value field to the new key.

This is what the `/mcp/cowork` MCP Server Trigger uses to authenticate outbound n8n API calls inside the workflow.

## Step 3 — Update Windows User environment variable

```powershell
[System.Environment]::SetEnvironmentVariable("N8N_API_KEY", "<new-key>", "User")
# Verify:
[System.Environment]::GetEnvironmentVariable("N8N_API_KEY", "User")
```

Do step 3 BEFORE step 4 — the recovery script in step 4 reads from this env var.

## Step 4 — Update ~/.claude.json

The n8n-local-builder stdio MCP uses the key directly. Targeted update (safe — only touches one value):

```powershell
$newKey = [System.Environment]::GetEnvironmentVariable("N8N_API_KEY", "User")
$cfg = Get-Content "$env:USERPROFILE\.claude.json" | ConvertFrom-Json
$cfg.mcpServers.'n8n-local-builder'.env.N8N_API_KEY = $newKey
$cfg | ConvertTo-Json -Depth 20 | Set-Content "$env:USERPROFILE\.claude.json" -Encoding utf8
```

Note: `ConvertFrom-Json` is safe here because we're only updating an existing value, not adding entries.

## Verify all 4 locations are working

```powershell
# 1. n8n API responds
curl.exe -H "X-N8N-API-KEY: $([Environment]::GetEnvironmentVariable('N8N_API_KEY','User'))" `
  https://api.passionate.agency/api/v1/workflows?limit=1

# 2. Claude Code MCP
# Restart Claude Code session; check: claude mcp list shows n8n-local-builder ✓ Connected

# 3. Cowork n8n connector — trigger a test via Cowork UI
```
