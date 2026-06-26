---
name: restore-claude-json
description: Safely add or restore MCP server entries in ~/.claude.json without wiping the mcpServers block.
---

# Skill: Restore / Edit ~/.claude.json Safely

## The rule

`ConvertFrom-Json → ConvertTo-Json` on `~/.claude.json` **silently wipes the entire `mcpServers` block** in PowerShell 5.1. The file contains Claude-internal fields that don't survive the round-trip.

- ✅ Safe for: reading a value, updating a value inside an EXISTING entry
- ❌ Never use for: adding a new entry, rebuilding the structure

---

## Restore n8n-local-builder (most common recovery)

```powershell
$key = [System.Environment]::GetEnvironmentVariable("N8N_API_KEY", "User")
$cfgPath = "$env:USERPROFILE\.claude.json"
$raw = Get-Content $cfgPath -Raw

$newEntry = '"n8n-local-builder":{"command":"npx","args":["n8n-mcp"],"env":{"N8N_API_URL":"https://api.passionate.agency/api/v1","N8N_API_KEY":"' + $key + '","MCP_MODE":"stdio","LOG_LEVEL":"error","DISABLE_CONSOLE_OUTPUT":"true"}}'

# If mcpServers is empty {}:
$raw = $raw -replace '("mcpServers"\s*:\s*\{)\s*\}', "`$1`n    $newEntry`n  }"
# If mcpServers has other entries already (append):
# $raw = $raw -replace '("mcpServers"\s*:\s*\{)([\s\S]*?)(\n\s*\})', "`$1`$2,`n    $newEntry`$3"

Set-Content $cfgPath $raw -Encoding utf8

# Verify — all server names should appear:
($raw | ConvertFrom-Json).mcpServers.PSObject.Properties.Name
```

## Add any stdio MCP entry

```powershell
$raw = Get-Content "$env:USERPROFILE\.claude.json" -Raw
$newEntry = '"server-name":{"command":"node","args":["C:\\path\\to\\cli.js","mcp"],"env":{"KEY":"val"}}'
$raw = $raw -replace '("mcpServers"\s*:\s*\{)([\s\S]*?)(\n\s*\})', "`$1`$2,`n    $newEntry`$3"
Set-Content "$env:USERPROFILE\.claude.json" $raw -Encoding utf8
($raw | ConvertFrom-Json).mcpServers.PSObject.Properties.Name
```

## Full mcpServers wipe recovery

If the entire mcpServers block is missing (the file shrank significantly):

```powershell
$key = [System.Environment]::GetEnvironmentVariable("N8N_API_KEY", "User")
$cfgPath = "$env:USERPROFILE\.claude.json"
$raw = Get-Content $cfgPath -Raw -Encoding utf8

$mcpBlock = @"
  "mcpServers": {
    "n8n-local-builder": {
      "command": "npx",
      "args": ["n8n-mcp"],
      "env": {
        "N8N_API_URL": "https://api.passionate.agency/api/v1",
        "N8N_API_KEY": "$key",
        "MCP_MODE": "stdio",
        "LOG_LEVEL": "error",
        "DISABLE_CONSOLE_OUTPUT": "true"
      }
    }
  },
"@

$updated = $raw -replace '^(\s*\{)', "`$1`n$mcpBlock"
Set-Content $cfgPath $updated -Encoding utf8

# Verify:
$v = Get-Content $cfgPath -Raw
Write-Host "mcpServers present: $($v -match '""mcpServers""')"
```

## Update a single value safely (ConvertFrom-Json IS safe here)

```powershell
$cfg = Get-Content "$env:USERPROFILE\.claude.json" | ConvertFrom-Json
$cfg.mcpServers.'n8n-local-builder'.env.N8N_API_KEY = "<new-value>"
$cfg | ConvertTo-Json -Depth 20 | Set-Content "$env:USERPROFILE\.claude.json" -Encoding utf8
```
