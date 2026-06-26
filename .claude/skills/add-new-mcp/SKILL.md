---
name: add-new-mcp
description: Add a new MCP server to the stack (PM2 -> Cloudflare Tunnel -> Cowork connector) using the standard 6-step pattern.
---

# Skill: Add a New MCP Server

Adds a new MCP server to the full stack: PM2 → Cloudflare Tunnel → Cowork connector.
Next available port: **6005**.

---

## Step 1 — Install the MCP package or write the code

**If it's a published npm package:**
```powershell
npm install -g <package-name>
# Script path: $env:APPDATA\npm\node_modules\<package>\dist\<entry>.js
```

**If it's custom code (new server you're building):**
```powershell
New-Item -ItemType Directory -Force -Path "C:\Users\user\AIBrain\mcp-servers\<name>"
# Write index.js there; install dependencies with npm install
```

## Step 2 — Create PM2 ecosystem config

Create `infra/pm2/<name>.config.cjs` using this template (supergateway + stdio pattern):

```js
const npmModules = process.env.APPDATA + '\\npm\\node_modules';
module.exports = {
  apps: [{
    name: '<name>-mcp',
    script: npmModules + '\\supergateway\\dist\\index.js',
    interpreter: 'node',
    args: [
      '--stdio', 'node ' + npmModules + '\\<package>\\dist\\<entry>.js mcp',
      // OR for custom code:
      // '--stdio', 'node C:\\Users\\user\\AIBrain\\mcp-servers\\<name>\\index.js',
      '--port', '<PORT>',             // next free port: 6005, 6006, ...
      '--outputTransport', 'streamableHttp',
      '--stateful',
      '--logLevel', 'info',
    ],
    autorestart: true, watch: false, max_restarts: 10, restart_delay: 5000,
    env: { /* config vars here */ },
  }],
};
```

Also copy the config to `C:\Users\user\pm2\` (live PM2 reads from there).

## Step 3 — Start PM2

```powershell
pm2 start "C:\Users\user\AIBrain\infra\pm2\<name>.config.cjs"
pm2 save
pm2 list  # verify status=online, restarts=0
```

## Step 4 — Add Cloudflare ingress rule (admin PowerShell required)

```powershell
# Open admin PS, then:
$f = "C:\Windows\System32\config\systemprofile\.cloudflared\config.yml"
$content = Get-Content $f -Raw

# Add new hostname BEFORE the api.passionate.agency rule.
# Use here-string to avoid YAML formatting issues:
$newRule = "  - hostname: <name>.passionate.agency`r`n    service: http://localhost:<PORT>`r`n"
$content = $content -replace "(  - hostname: api\.passionate\.agency)", "$newRule`$1"
Set-Content $f $content -Encoding utf8

# Restart tunnel
sc.exe stop cloudflared; Start-Sleep 3; sc.exe start cloudflared
```

Update `infra/cloudflared/config.yml.example` with the same rule.

## Step 5 — Add Cloudflare DNS record

In Cloudflare Dashboard → passionate.agency → DNS → Add record:
- Type: **CNAME**
- Name: `<name>`
- Target: `30618ade-6269-438c-b28a-3fca6b8d297b.cfargotunnel.com`
- Proxied: ✅

## Step 6 — Wire up Cowork and Claude Code

In Cowork → Settings → Connectors → Add:
```
https://<name>.passionate.agency/mcp
```
This makes it available in both Cowork AND Claude Code automatically.

Verify:
```powershell
claude mcp list  # should show: claude.ai <name>: https://<name>.passionate.agency/mcp - ✓ Connected
curl.exe -s -o NUL -w "%{http_code}" https://<name>.passionate.agency/mcp  # expect 200 or 405
```

## After adding — update these files

- `docs/port-assignments.md` — add new port entry
- `docs/mcp-registry.md` — add new MCP row
- `infra/cloudflared/config.yml.example` — add ingress rule
- `AGENTS.md` — add to MCP Registry table if it's regularly used
