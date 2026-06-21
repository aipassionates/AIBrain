# Cloudflare Tunnel — Restore Guide

## Normal edits (add/remove service)

Must run in **admin PowerShell** (service runs as LocalSystem):

```powershell
$f = "C:\Windows\System32\config\systemprofile\.cloudflared\config.yml"
# Read, edit (add new hostname BEFORE the api.passionate.agency rule), write back
# Use a here-string (@'...'@) — safer than string manipulation for YAML
sc.exe stop cloudflared; Start-Sleep 2; sc.exe start cloudflared
```

After adding a new ingress rule, also add a DNS CNAME in Cloudflare Dashboard:
- Type: CNAME
- Name: `<subdomain>`
- Target: `30618ade-6269-438c-b28a-3fca6b8d297b.cfargotunnel.com`
- Proxied: ✅

## Full tunnel restore (new machine)

1. Install cloudflared: download from `github.com/cloudflare/cloudflared/releases`
2. `cloudflared login` (browser OAuth with Cloudflare account)
3. Re-use existing tunnel: `cloudflared tunnel use <CF_TUNNEL_ID>` — or create new with `cloudflared tunnel create passionate-agency`
4. Copy `config.yml.example` → SYSTEM path, replace `<CF_TUNNEL_ID>` with real value
5. Copy tunnel credentials JSON to SYSTEM path (from password manager backup)
6. `cloudflared service install`
7. `sc.exe start cloudflared`

## If tunnel credential JSON is lost

You cannot re-use the same tunnel ID without its credential JSON. Options:
- Restore credential JSON from password manager (back it up there!)
- Create a new tunnel (`cloudflared tunnel create`), update config.yml and DNS records

## Tunnel ID

`30618ade-6269-438c-b28a-3fca6b8d297b` — store the matching JSON credential in password manager.
