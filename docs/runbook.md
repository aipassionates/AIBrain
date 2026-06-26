# Runbook — Incidents, Gotchas, Non-Obvious Fixes

Incidents that cost time to debug, written down so they don't cost time again.

---

## cloudflared Windows service ignores ~/.cloudflared/config.yml

**Symptom:** Editing `~/.cloudflared/config.yml` has no effect on the running tunnel.
**Root cause:** The service was installed with `cloudflared service install` which runs as LocalSystem. The binary is hardcoded to read `C:\Windows\System32\config\systemprofile\.cloudflared\config.yml`.
**Fix:** Always edit the SYSTEM path. Admin PowerShell required. See `.claude/skills/add-new-mcp/SKILL.md` Step 4.

---

## PowerShell ConvertFrom-Json wipes mcpServers in ~/.claude.json

**Symptom:** After editing `~/.claude.json` with ConvertFrom-Json → ConvertTo-Json, `claude mcp list` shows no servers. The file shrank.
**Root cause:** PowerShell 5.1's ConvertTo-Json drops Claude-internal fields it doesn't know about. The `mcpServers` block disappears entirely.
**Fix:** Use raw string replacement to ADD entries. Only use ConvertFrom-Json to update an existing value. See `.claude/skills/restore-claude-json/SKILL.md`.
**Has happened:** Twice (May 2026).

---

## n8n ToolCode sandbox blocks HTTP

**Symptom:** n8n AI tool using Code node fails with "fetch is not defined" or similar.
**Root cause:** n8n's ToolCode sandbox explicitly blocks network access (fetch, require('http'), require('https')).
**Fix:** Use `ToolHttpRequest` node type instead (`@n8n/n8n-nodes-langchain.toolHttpRequest` v1.1). Supports `{placeholder}` syntax for AI-filled parameters.

---

## n8n API rejects workflow settings with ZodError

**Symptom:** `n8n_update_full_workflow` fails with a ZodError mentioning `binaryMode` or similar field.
**Root cause:** The n8n workflow settings object only accepts known fields. Undocumented fields are rejected by schema validation.
**Fix:** Only include `{ "executionOrder": "v1" }` in the settings object. Strip any other fields.

---

## Webhooks not registered after n8n API workflow update

**Symptom:** After updating a workflow via the n8n API, the webhook endpoint returns 404.
**Root cause:** API updates don't trigger webhook re-registration. The workflow must be deactivated and reactivated.
**Fix:** After any API edit, deactivate then reactivate the workflow (n8n UI toggle, or API `PATCH /workflows/{id}` with `active: false` then `active: true`).

---

## LinkedHelper Squirrel launcher exits immediately (CDP never connects)

**Symptom:** lhremote can't connect to CDP port 9222 despite LinkedHelper appearing to open.
**Root cause:** `C:\Users\user\AppData\Local\linked-helper\linked-helper.exe` is a Squirrel update stub that launches the real app and immediately exits. The `--remote-debugging-port=9222` flag must be passed to the VERSIONED exe in `app-X.X.XX\`.
**Fix:** Startup shortcut target must point to the versioned path, not the root exe. After LH updates, run `update-linkedhelper-path.ps1`.

---

## AV1 video downloads are unplayable on Windows

**Symptom:** Downloaded MP4 plays as audio only or fails entirely in Windows media players.
**Root cause:** yt-dlp's default "best" format for YouTube picks AV1 (av01) codec which most Windows players don't support.
**Fix:** Use explicit format selector in download_video: `bestvideo[height<=480][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=480]+bestaudio/best[height<=480]`. Already set in media-mcp/index.js. Convert existing files with: `ffmpeg -i input.mp4 -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -vf scale=-2:480 -movflags +faststart output.mp4`

---

## n8n API SSRF blocks localhost from Claude Code

**Symptom:** n8n API calls from Claude Code to `http://localhost:5678` return connection refused or SSRF error.
**Root cause:** Claude Code's sandbox blocks SSRF to localhost.
**Fix:** Always use `https://api.passionate.agency/api/v1` from Claude Code. `localhost:5678` works only from inside n8n workflows (server-side calls).

---

## PM2 auto-start not working after machine restart

**Symptom:** PM2 processes are offline after reboot.
**Root cause:** `pm2 save` wasn't run after changes, or pm2-windows-startup wasn't initialized.
**Fix:**
```powershell
pm2 save
pm2-startup install  # if first time
# Verify Task Scheduler has the PM2 startup task
```
