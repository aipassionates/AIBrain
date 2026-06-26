# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

---

## n8n Workflow Authoring (Claude-specific)

- MCP Server Trigger: typeVersion **2**, transport Streamable HTTP, endpoint `https://api.passionate.agency/mcp/{path}`
- `ToolHttpRequest` node type: `@n8n/n8n-nodes-langchain.toolHttpRequest` version 1.1 — supports `{placeholder}` in URL/body for AI-filled params
- `settings` in `n8n_update_full_workflow`: only `{ "executionOrder": "v1" }` — reject any additional fields
- After any API edit: deactivate → reactivate the workflow (n8n UI or API) to re-register webhooks

---

## Recovery Scripts

### Restore n8n-local-builder to ~/.claude.json

Run when `claude mcp list` doesn't show `n8n-local-builder`:

```powershell
$key = [System.Environment]::GetEnvironmentVariable("N8N_API_KEY", "User")
$cfgPath = "$env:USERPROFILE\.claude.json"
$raw = Get-Content $cfgPath -Raw
$newEntry = '"n8n-local-builder":{"command":"npx","args":["n8n-mcp"],"env":{"N8N_API_URL":"https://api.passionate.agency/api/v1","N8N_API_KEY":"' + $key + '","MCP_MODE":"stdio","LOG_LEVEL":"error","DISABLE_CONSOLE_OUTPUT":"true"}}'
# Use first form if mcpServers is {}, second form if it has existing entries:
$raw = $raw -replace '("mcpServers"\s*:\s*\{)\s*\}', "`$1`n    $newEntry`n  }"
# $raw = $raw -replace '("mcpServers"\s*:\s*\{)([\s\S]*?)(\n\s*\})', "`$1`$2,`n    $newEntry`$3"
Set-Content $cfgPath $raw -Encoding utf8
($raw | ConvertFrom-Json).mcpServers.PSObject.Properties.Name  # verify all servers present
```

### Add any stdio MCP to ~/.claude.json (safe pattern)

```powershell
$raw = Get-Content "$env:USERPROFILE\.claude.json" -Raw
$newEntry = '"server-name":{"command":"node","args":["C:\\path\\to\\cli.js","mcp"],"env":{"KEY":"val"}}'
$raw = $raw -replace '("mcpServers"\s*:\s*\{)([\s\S]*?)(\n\s*\})', "`$1`$2,`n    $newEntry`$3"
Set-Content "$env:USERPROFILE\.claude.json" $raw -Encoding utf8
($raw | ConvertFrom-Json).mcpServers.PSObject.Properties.Name
```

### Rotate n8n API key

See `.claude/skills/rotate-n8n-api-key/SKILL.md` — 4 locations must be updated in order.

### LinkedHelper version update

See `.claude/skills/update-linkedhelper-version/SKILL.md` — 3 paths must be updated.

### Full machine restore

See `.claude/skills/restore-machine/SKILL.md` and run `infra/scripts/restore-machine.ps1`.
