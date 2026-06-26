# Port Assignments

| Port | Service | PM2 name | Public URL |
|---|---|---|---|
| 5678 | n8n | `n8n` | `https://api.passionate.agency` |
| 6002 | LinkedHelper MCP | `linkedhelper-mcp` | `https://lh.passionate.agency/mcp` |
| 6003 | Media Extract MCP | `media-extract-mcp` | `https://media.passionate.agency/mcp` |
| 6004 | Google Analytics MCP | `google-analytics-mcp` | `https://analytics.passionate.agency/mcp` |
| **6005** | **Next available** | — | — |

## Cloudflare tunnel ID

`30618ade-6269-438c-b28a-3fca6b8d297b`

DNS CNAME target: `30618ade-6269-438c-b28a-3fca6b8d297b.cfargotunnel.com`

## Subdomain pattern

`<service>.passionate.agency` → port `60XX` → SYSTEM cloudflared config ingress rule

## When adding a new service

1. Use the next port in sequence (6005, 6006, …)
2. Update this file
3. Follow `.claude/skills/add-new-mcp/SKILL.md`
