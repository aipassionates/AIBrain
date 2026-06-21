# LinkedIn Outreach

Automated LinkedIn prospecting and messaging using LinkedHelper via MCP.

## Stack

- **LinkedHelper** (desktop app, auto-starts via Startup shortcut)
- **lhremote** (npm, MCP server connecting via CDP port 9222)
- **linkedhelper-mcp** (PM2 service, supergateway, port 6002)
- Public: `https://lh.passionate.agency/mcp` (75 tools)

## Status

Active — campaigns can be created and managed via Claude Code or Cowork.

## Key workflows (Claude → LinkedHelper MCP)

1. `collect-people` — scrape profiles from a LinkedIn search URL into a collection
2. `campaign-create` → `campaign-add-action` → `campaign-start` — outreach sequences
3. `query-messages` + `check-replies` — monitor inbox and replies
4. `enrich-profile` — get full profile data for a person

## Important operational notes

- LinkedHelper app must be open and accounts must be "Started" in the LH UI for live-action tools
- DB-only tools (campaign-list, check-status) work without accounts started
- After LinkedHelper updates: run `infra/scripts/update-linkedhelper-path.ps1 -NewVersion <X.X.XX>`
- LinkedIn imposes daily action limits — check `get-action-budget` and `get-throttle-status` before large campaigns
