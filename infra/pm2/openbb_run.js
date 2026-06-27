// PM2 launches this with Node (PM2's native, reliable mode on Windows), and Node
// spawns the REAL uv-managed CPython to run the OpenBB MCP launcher. This avoids the
// pitfalls of pointing PM2 at a binary directly:
//   - PM2 `interpreter: 'none'` silently fails to spawn a bare .exe.
//   - uv trampolines (openbb-mcp.exe / venv python.exe) crash under PM2 with
//     "uv trampoline failed to canonicalize script path".
// openbb_run.py then does site.addsitedir() on the tool venv so all deps resolve.
const { spawn } = require('child_process');

const PYDIR = 'C:\\tools\\openbb\\pythons\\cpython-3.12.13-windows-x86_64-none';
const PY = PYDIR + '\\python.exe';
const ARGS = [
  'C:\\Users\\user\\pm2\\openbb_run.py',
  '--host', '127.0.0.1',
  '--port', '6005',
  // No --tool-discovery: expose ALL categories' tools directly (callable without an
  // activation round-trip), so it works in Cowork/web/Claude Code, not just Desktop.
  // Trade-off: ~270 tool schemas load when the connector is active -> scope it to the
  // finance project so it doesn't bloat unrelated chats.
];

// libuv's uv_spawn on Windows returns ENOENT for an absolute exe path when the child's
// PATH is empty. PM2's long-lived daemon can pass a sanitized env, so guarantee a PATH.
const env = { ...process.env };
const sysRoot = process.env.SystemRoot || 'C:\\Windows';
const basePath = env.PATH || env.Path || (sysRoot + '\\System32;' + sysRoot);
env.PATH = PYDIR + ';' + basePath;
delete env.Path; // avoid duplicate-casing ambiguity on Windows

const child = spawn(PY, ARGS, { stdio: 'inherit', env, windowsHide: true });

const stop = () => { try { child.kill(); } catch (e) { /* already gone */ } };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', stop);

child.on('error', (e) => { console.error('failed to spawn python:', e); process.exit(1); });
child.on('exit', (code) => process.exit(code === null ? 1 : code));
