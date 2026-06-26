// PM2 ecosystem config — google-analytics-mcp
// Wraps mcp-servers/google-analytics-mcp/index.js with supergateway → port 6004
// Public: https://analytics.passionate.agency/mcp
//
// LIVE PATH: C:\tools\google-analytics-mcp\index.js (until migrated)
// TARGET PATH after migration: C:\Users\user\AIBrain\mcp-servers\google-analytics-mcp\index.js
// Run infra/scripts/migrate-mcp-servers.ps1 to migrate.
//
// Auth: credentials.json + token.json must be present at CREDENTIALS_PATH/TOKEN_PATH.
// These are gitignored. If lost: get credentials.json from Google Cloud Console,
// then run: node mcp-servers/google-analytics-mcp/auth.js

const npmModules = process.env.APPDATA + '\\npm\\node_modules';

module.exports = {
  apps: [{
    name: 'google-analytics-mcp',
    script: npmModules + '\\supergateway\\dist\\index.js',
    interpreter: 'node',
    // Update this path after running migrate-mcp-servers.ps1:
    args: [
      '--stdio', 'node C:\\tools\\google-analytics-mcp\\index.js',
      '--port', '6004',
      '--outputTransport', 'streamableHttp',
      '--stateful',
      '--logLevel', 'info',
    ],
    autorestart: true,
    watch: false,
    max_restarts: 10,
    restart_delay: 5000,
    env: {
      GA4_PROPERTY_ID:  '321752992',
      GSC_SITE_URL:     'https://passionates.com/',
      CREDENTIALS_PATH: 'C:\\tools\\google-analytics-mcp\\credentials.json',
      TOKEN_PATH:       'C:\\tools\\google-analytics-mcp\\token.json',
    },
  }],
};
