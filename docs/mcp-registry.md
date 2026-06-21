# MCP Registry

Complete list of all MCP connections available to Claude Code and Cowork.

---

## Local / Stdio (in ~/.claude.json)

| Name | Command | Purpose | Status |
|---|---|---|---|
| `n8n-local-builder` | `npx n8n-mcp` | Build/edit/delete n8n workflows, manage credentials | ✅ Active |

## Cloud Connectors (Cowork + Claude Code via claude.ai scope)

### Custom-built (this repo)

| Connector name | URL | Source | Tools | Status |
|---|---|---|---|---|
| n8n-executor | `https://api.passionate.agency/mcp/cowork` | n8n workflow `2zxCSXHtmY76XU69` | list_workflows, trigger_webhook_workflow, get_recent_executions, get_execution_details | ✅ Active |
| linkedhelper | `https://lh.passionate.agency/mcp` | `npm lhremote` | 75 tools — campaigns, messaging, profiles, feed, search | ✅ Active |
| media-extract | `https://media.passionate.agency/mcp` | `mcp-servers/media-mcp/` | video_info, extract_transcript, download_video, download_audio, list_downloads | ✅ Active |
| google-analytics | `https://analytics.passionate.agency/mcp` | `mcp-servers/google-analytics-mcp/` | ga4_run_report, gsc_query_performance, gsc_list_sites | ✅ Active |

### Third-party cloud connectors

| Connector | Provider | Key capabilities | Notes |
|---|---|---|---|
| Telnyx | Telnyx | Voice calls, SMS, number intelligence | Bearer key in Cowork |
| Supabase | Supabase | Full DB management, edge functions, migrations | Service key |
| Gmail | Google | Read threads, label, search, create drafts | OAuth |
| Google Calendar | Google | CRUD events, check availability | OAuth |
| Google Drive | Google | File ops, read/write docs | OAuth |
| Outlook | Microsoft | Calendar, find available time | OAuth |
| LinkedIn (plugin) | Third-party plugin | Profile/campaign automation (via plugin) | Separate from lh.passionate.agency |
| HubSpot (plugin) | HubSpot | CRM (planned) | Needs auth |
| Apollo (plugin) | Apollo.io | Lead enrichment (planned) | Needs auth |

---

## Plugin MCPs (authenticate separately in Cowork)

These are Cowork-managed plugins that authenticate independently:

| Plugin | Status | Use case |
|---|---|---|
| LinkedIn | Available | Profile enrichment |
| HubSpot | Not configured | CRM |
| Apollo | Not configured | Lead data |
| Slack | Not configured | Notifications |
| Notion | Not configured | Knowledge base |
| Klaviyo | Not configured | Email marketing |
| Canva | Not configured | Design |
| Figma | Not configured | Design |
| Ahrefs | Not configured | SEO |
| SimilarWeb | Not configured | Competitive intel |

---

## n8n-local-builder vs n8n-executor

| Capability | n8n-local-builder (stdio) | n8n-executor (cloud) |
|---|---|---|
| Create/edit/delete workflows | ✅ | ❌ |
| Manage credentials | ✅ | ❌ |
| Validate and audit | ✅ | ❌ |
| Search nodes/templates | ✅ | ❌ |
| Trigger a webhook workflow | ❌ | ✅ |
| List workflows (lightweight) | ✅ | ✅ |
| Monitor executions | ✅ (via n8n_executions) | ✅ |
| Available in Cowork | ❌ | ✅ |

Both must be present — neither replaces the other.
