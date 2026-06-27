// OpenBB MCP — financial data (prices, fundamentals, SEC, FRED, crypto, etc.)
// Serves streamable-http MCP natively on localhost:6005 (no supergateway needed).
// Exposed publicly as https://finance.passionate.agency/mcp via the Cloudflare tunnel.
//
// PM2 runs the Node wrapper (openbb_run.js) — its native, reliable mode on Windows —
// which spawns the real uv-managed CPython to run openbb_run.py. We do NOT point PM2
// at a binary directly: `interpreter:'none'` silently fails to spawn a bare .exe, and
// uv's trampolines (openbb-mcp.exe / venv python.exe) crash under PM2 with
// "uv trampoline failed to canonicalize script path".
//
// --tool-discovery (set inside openbb_run.js) keeps the initial tool surface tiny
// (~10 meta-tools); data tools activate on demand, keeping client context small.
//
// Port note: 6002=linkedhelper, 6003=media-extract, 6004=google-analytics, so 6005.
module.exports = {
  apps: [{
    name: 'openbb-finance-mcp',
    script: 'C:\\Users\\user\\pm2\\openbb_run.js',
    autorestart: true,
    watch: false,
    max_restarts: 10,
    restart_delay: 5000,
    env: {},
  }],
};
