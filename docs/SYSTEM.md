# SYSTEM.md — Machine Manifest & Prerequisites

What's installed, where, and which versions — so a rebuild can **replicate the environment first**,
then restore code (git) and secrets (Bitwarden). Pair this with `RECOVERY.md`.

> Snapshot: 2026-06-27. Refresh anytime by re-running the commands in the last section (or ask Claude).

## OS
- Microsoft Windows 11 Enterprise (build 26200)

## Core runtimes — install FIRST, in this order
| Tool | Version | Location | Source |
|---|---|---|---|
| Node.js | v24.15.0 | `C:\Program Files\nodejs\` | nodejs.org |
| npm | 11.14.1 | bundled with Node | — |
| Git | 2.54.0 | on PATH | git-scm.com |
| Python | (OpenBB venv) | `C:\tools\openbb\venv` | python.org (for OpenBB) |

## Global npm packages (`npm install -g`)
| Package | Version | Purpose |
|---|---|---|
| pm2 | 7.0.1 | process manager — runs the whole stack |
| pm2-windows-startup | 1.0.3 | auto-start pm2 on boot (Registry Run key) |
| pm2-windows-service | 0.2.1 | pm2 service helper |
| n8n | 2.21.5 | automation engine |
| n8n-mcp | 2.56.0 | `n8n-local-builder` MCP (build workflows) |
| supergateway | 3.4.3 | wraps stdio MCPs as Streamable HTTP |
| lhremote | 0.20.1 | LinkedHelper MCP |
| mcp-remote | 0.1.38 | MCP remote helper |
| @anthropic-ai/claude-code | 2.1.193 | Claude Code CLI |

One-line install:
```
npm install -g pm2 pm2-windows-startup pm2-windows-service n8n n8n-mcp supergateway lhremote mcp-remote @anthropic-ai/claude-code
```
- npm global root: `C:\Users\user\AppData\Roaming\npm\node_modules`

## Binaries in C:\tools
| File | Version | Source |
|---|---|---|
| `yt-dlp.exe` | 2026.03.17 | github.com/yt-dlp/yt-dlp |
| `ffmpeg.exe` / `ffprobe.exe` | bundled | ffmpeg.org |

## Services / system components
| Component | How it runs | Version |
|---|---|---|
| cloudflared | Windows service (LocalSystem); config at SYSTEM `.cloudflared` path | 2026.5.0 |
| LinkedHelper | desktop app, Startup-folder shortcut, CDP port 9222 | check the `app-X.X.XX` folder after updates |
| VS Code tunnel | `code-tunnel` service (auto-start Registry Run key) | — |

## PM2 processes (the running stack)
`n8n` (id 0) · `linkedhelper-mcp` (1) · `media-extract-mcp` (2) · `google-analytics-mcp` (3) · `openbb-finance-mcp` (7) · `seo-weekly` (8, Monday cron).
Configs: `infra/pm2/` (canonical) and `C:\Users\user\pm2\` (live).

## Rebuild prerequisite order
1. Windows
2. Node.js → npm
3. Git
4. `npm install -g …` (packages above)
5. Python + OpenBB platform (venv at `C:\tools\openbb`)
6. cloudflared (Windows service)
7. yt-dlp + ffmpeg → `C:\tools`
8. LinkedHelper desktop app (+ Startup shortcut, `--remote-debugging-port=9222`)
9. **Then follow `RECOVERY.md`** (clone repo → restore secrets → copy code/configs → `pm2 start` → verify)

## Re-capture versions (run anytime to refresh this doc)
```powershell
node --version; npm --version; pm2 --version; git --version
npm ls -g --depth=0
& 'C:\tools\yt-dlp.exe' --version
& 'C:\Program Files (x86)\cloudflared\cloudflared.exe' --version
```
