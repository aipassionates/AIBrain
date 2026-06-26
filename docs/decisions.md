# Architecture Decision Record

Short log of what was chosen, what was rejected, and why. Updated as decisions are made.

---

## 2026-05 — n8n for workflow orchestration

**Chose:** n8n self-hosted (PM2, port 5678)
**Rejected:** direct API integrations from Claude Code, Zapier, Make
**Why:** n8n gives visual debuggability, credential management, retry logic, and webhook handling in one place. Claude builds and triggers the workflows via MCP rather than calling third-party APIs directly — keeps automation reproducible and auditable even when Claude sessions end.

---

## 2026-05 — Cloudflare Tunnel over ngrok / direct exposure

**Chose:** cloudflared Windows service (LocalSystem, permanent tunnel)
**Rejected:** ngrok (ephemeral URLs, paid for stable), direct port forwarding (security risk)
**Why:** Free, permanent subdomain, no auth token rotation, integrates with Cloudflare Access if needed. Critical gotcha: service runs as LocalSystem — config is at SYSTEM profile path, not user profile.

---

## 2026-05 — PM2 for process management

**Chose:** PM2 + pm2-windows-startup (Task Scheduler auto-start)
**Rejected:** Windows services for each process, Docker
**Why:** PM2 gives unified log access (`pm2 logs`), restart policies, and ecosystem config files. Docker would add complexity with minimal benefit on a single Windows machine. pm2-windows-startup bridges PM2 to Windows startup without needing each app to be a full service.

---

## 2026-05 — supergateway for stdio → HTTP MCP bridging

**Chose:** supergateway wrapping lhremote (and custom MCPs) as Streamable HTTP
**Rejected:** running MCPs as pure stdio Claude Code connections only
**Why:** Cowork (the cloud agent frontend) only supports HTTP MCP servers, not stdio. supergateway converts any stdio MCP to Streamable HTTP with one command. Same PM2 pattern for all custom MCPs.

---

## 2026-05 — Split n8n MCP into two connections

**Chose:** n8n-local-builder (stdio, 20+ build tools) + n8n-executor (cloud connector, 4 run tools)
**Rejected:** exposing the full n8n management API publicly, merging into one connection
**Why:** Management tools (create/delete workflows, access all credentials) should not be exposed publicly even with URL obscurity. The executor tools are safe to expose — the n8n workflow handles auth internally. Both are always required; neither replaces the other.

---

## 2026-06 — AGENTS.md as canonical cross-harness context

**Chose:** AGENTS.md as primary context file, CLAUDE.md importing it with `@AGENTS.md`
**Rejected:** maintaining separate files per harness (CLAUDE.md, .cursorrules, Hermes config separately)
**Why:** AGENTS.md is the cross-platform standard (IETF-donated 2025, supported by Codex, Cursor, Gemini CLI, Hermes). One file to maintain; each harness reads it in its own way. CLAUDE.md adds only Claude-specific recovery scripts. Reduces drift between harnesses.

---

## 2026-06 — passionate-agency/ as git root, not ~/ (home dir)

**Chose:** `C:\Users\user\AIBrain\` as the git repo root
**Rejected:** making `C:\Users\user\` itself a git repo
**Why:** Home dir as git root risks committing sensitive files (.claude.json, AppData shortcuts, etc.) and creates a messy .gitignore problem. A dedicated subdirectory is clean, portable, and clonable on a new machine without home dir assumptions.

---

## 2026-06 — Custom MCP source in mcp-servers/ (repo canonical, C:\tools live until migrated)

**Chose:** `mcp-servers/` in this repo as the canonical source; C:\tools\ as the live location until `migrate-mcp-servers.ps1` is run
**Rejected:** leaving custom MCPs permanently in C:\tools\ (no version control, disaster risk)
**Why:** media-mcp and google-analytics-mcp are custom-written; if the machine burns they're gone. npm-installable MCPs (lhremote, n8n-mcp) don't need to be in the repo. Run `infra/scripts/migrate-mcp-servers.ps1` to move the live copies and update PM2.
