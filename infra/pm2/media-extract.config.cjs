// PM2 ecosystem config — media-extract-mcp
// Wraps mcp-servers/media-mcp/index.js with supergateway → Streamable HTTP on port 6003
// Public: https://media.passionate.agency/mcp
//
// LIVE PATH: C:\tools\media-mcp\index.js (until migrated to mcp-servers/)
// TARGET PATH after migration: C:\Users\user\passionate-agency\mcp-servers\media-mcp\index.js
// Run infra/scripts/migrate-mcp-servers.ps1 to migrate and restart PM2.
//
// To change storage/quality: edit env block, then: pm2 restart media-extract-mcp && pm2 save

const npmModules = process.env.APPDATA + '\\npm\\node_modules';

module.exports = {
  apps: [{
    name: 'media-extract-mcp',
    script: npmModules + '\\supergateway\\dist\\index.js',
    interpreter: 'node',
    // Update this path after running migrate-mcp-servers.ps1:
    args: [
      '--stdio', 'node C:\\tools\\media-mcp\\index.js',
      '--port', '6003',
      '--outputTransport', 'streamableHttp',
      '--stateful',
      '--logLevel', 'info',
    ],
    autorestart: true,
    watch: false,
    max_restarts: 10,
    restart_delay: 5000,
    env: {
      MEDIA_ROOT:    'D:\\media',
      MAX_HEIGHT:    '480',
      VIDEO_FORMAT:  'mp4',
      AUDIO_FORMAT:  'mp3',
      AUDIO_QUALITY: '128K',
      YTDLP_PATH:    'C:\\tools\\yt-dlp.exe',
    },
  }],
};
