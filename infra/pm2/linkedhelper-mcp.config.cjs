// PM2 ecosystem config — linkedhelper-mcp
// Wraps lhremote (npm global) with supergateway → Streamable HTTP on port 6002
// Public: https://lh.passionate.agency/mcp
//
// LINKEDHELPER_PATH: update to newest app-X.X.XX folder after LH auto-updates.
// See skills/update-linkedhelper-version.md for all 3 places to change.

const npmModules = process.env.APPDATA + '\\npm\\node_modules';

module.exports = {
  apps: [{
    name: 'linkedhelper-mcp',
    script: npmModules + '\\supergateway\\dist\\index.js',
    interpreter: 'node',
    args: [
      '--stdio', 'node ' + npmModules + '\\lhremote\\dist\\cli.js mcp',
      '--port', '6002',
      '--outputTransport', 'streamableHttp',
      '--stateful',
      '--logLevel', 'info',
    ],
    autorestart: true,
    watch: false,
    max_restarts: 10,
    restart_delay: 5000,
    env: {
      LINKEDHELPER_PATH: 'C:\\Users\\user\\AppData\\Local\\linked-helper\\app-2.113.78\\linked-helper.exe',
    },
  }],
};
