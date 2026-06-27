/**
 * PM2 ecosystem — seo-weekly (deterministic weekly SEO data pipeline)
 *
 * Runs C:\tools\run-weekly.js every Monday 07:00 local via cron_restart.
 * No AI, no permission prompts, runs offline — fetches GSC+GA4, fills content +
 * performance tables, verifies, writes last-run.json, emails if Gmail creds are set.
 *
 * Start once:  pm2 start C:\Users\user\pm2\seo-weekly.config.cjs && pm2 save
 * Manual run:  pm2 restart seo-weekly         (fires the whole pipeline now)
 * Logs:        pm2 logs seo-weekly
 *
 * Email (optional): set GMAIL_USER + GMAIL_APP_PASSWORD as USER env vars (never hardcode
 * the password here), then `pm2 restart seo-weekly --update-env && pm2 save`.
 */
module.exports = {
  apps: [{
    name: 'seo-weekly',
    script: 'C:\\tools\\run-weekly.js',
    interpreter: 'node',
    cron_restart: '0 7 * * 1',   // Mondays 07:00 local
    autorestart: false,          // one-shot per cron fire — do not loop
    watch: false,
    max_restarts: 3,
    env: {
      SEO_REPORT_TO: 'gor@passionates.com',
      GA4_PROPERTY_ID: '321752992',
      GSC_SITE_URL: 'https://passionates.com/',
    },
  }],
};
