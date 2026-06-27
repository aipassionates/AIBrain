/**
 * GA4 Enrichment
 *
 * Reads saved GA4 report (pagePath, activeUsers, userEngagementDuration, sessions)
 * and populates:
 *   ga_users              — total active users
 *   ga_avg_engagement_sec — avg engagement seconds per session
 *
 * Run: node C:/tools/enrich-ga4.js
 */
'use strict';
const fs    = require('fs');
const https = require('https');
const path  = require('path');

const SUPABASE = 'https://cjwwkmaiqsbgygqtjxel.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

const GA4_FILE = 'C:\\tools\\data\\ga4-data.json';

function sbPatch(urlFull, fields, retries = 2) {
  return new Promise((resolve, reject) => {
    const str = JSON.stringify(fields);
    const p = `/rest/v1/content?url_full=eq.${encodeURIComponent(urlFull)}`;
    const u = new URL(SUPABASE + p);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'PATCH',
      headers: {
        apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(str),
        Prefer: 'return=minimal',
      },
    }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', err => {
      if (retries > 0 && (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT')) {
        setTimeout(() => sbPatch(urlFull, fields, retries - 1).then(resolve, reject), 1000);
      } else { reject(err); }
    });
    req.setTimeout(20000, () => { const e = new Error('socket timeout'); e.code = 'ETIMEDOUT'; req.destroy(e); });
    req.write(str); req.end();
  });
}

async function main() {
  console.log('=== GA4 ENRICHMENT ===\n');

  const data = JSON.parse(fs.readFileSync(GA4_FILE, 'utf8'));
  const rows = data.rows || [];
  console.log(`Loaded ${rows.length} GA4 page rows.`);

  // Aggregate by normalized url_full BEFORE writing. GA4 returns SEPARATE rows for the
  // trailing-slash and non-trailing-slash variants of the same page (e.g. "/" and "",
  // "/checkout/" and "/checkout"). Both collapse to one Supabase url_full, so their
  // metrics must be SUMMED. Without this, the last row processed silently overwrites the
  // first — which is exactly what zeroed the homepage ("/"=22215 clobbered by ""=1).
  const agg = new Map(); // fullUrl -> { users, engSecs, sessions }
  for (const row of rows) {
    const users    = parseInt(row.activeUsers, 10);
    const engSecs  = parseInt(row.userEngagementDuration, 10);
    const sessions = parseInt(row.sessions, 10);
    if (isNaN(users) || users === 0) continue;

    // Supabase url_full stores WITHOUT trailing slash and LOWERCASE — GA4 reports
    // mixed-case silo paths (e.g. /Web-Design-Agency/...), so lowercase to match.
    const normPath = row.pagePath === '/' ? '' : (row.pagePath || '').replace(/\/$/, '').toLowerCase();
    const fullUrl = 'https://passionates.com' + normPath;

    const cur = agg.get(fullUrl) || { users: 0, engSecs: 0, sessions: 0 };
    cur.users    += users;
    cur.engSecs  += isNaN(engSecs)  ? 0 : engSecs;
    cur.sessions += isNaN(sessions) ? 0 : sessions;
    agg.set(fullUrl, cur);
  }
  console.log(`Aggregated to ${agg.size} unique URLs.\n`);

  let nUpdated = 0, nErrors = 0;

  // Bounded-concurrency writes (sequential awaits over ~3000 URLs are too slow / time out).
  const entries = [...agg.entries()];
  let ti = 0;
  async function worker() {
    while (ti < entries.length) {
      const [fullUrl, m] = entries[ti++];
      const update = {
        ga_users:              m.users,
        ga_avg_engagement_sec: m.sessions > 0 ? Math.round(m.engSecs / m.sessions) : 0,
      };
      try {
        const status = await sbPatch(fullUrl, update);
        if (status >= 200 && status < 300) nUpdated++;
        else { nErrors++; if (nErrors <= 5) console.log(`  ERR ${status}: ${fullUrl}`); }
      } catch (e) {
        nErrors++; if (nErrors <= 5) console.log(`  ERR ${e.code || e.message}: ${fullUrl}`);
      }
    }
  }
  await Promise.all(Array.from({ length: 12 }, () => worker()));

  console.log('\n=== DONE ===');
  console.log(`  Aggregated URLs: ${agg.size}`);
  console.log(`  Updated  : ${nUpdated}`);
  console.log(`  Errors   : ${nErrors}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
