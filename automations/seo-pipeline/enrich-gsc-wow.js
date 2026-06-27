/**
 * GSC Week-over-Week Enrichment
 *
 * Reads current week and previous week GSC data from C:\tools\data\,
 * computes WoW delta, and populates:
 *   gsc_clicks_wow   — current week clicks
 *   gsc_position_wow — current week avg position
 *
 * Run: node C:/tools/enrich-gsc-wow.js
 */
'use strict';
const fs    = require('fs');
const https = require('https');
const path  = require('path');

const SUPABASE = 'https://cjwwkmaiqsbgygqtjxel.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

const DATA_DIR  = 'C:\\tools\\data';
const FILE_CURR = path.join(DATA_DIR, 'gsc-curr7.json');  // Current 7-day window
const FILE_PREV = path.join(DATA_DIR, 'gsc-prev7.json');  // Previous 7-day window

function normUrl(url) {
  // Lowercase — content.url_full is lowercase; GSC reports mixed-case silo paths.
  try { return new URL(url).pathname.replace(/\/$/, '').toLowerCase() || '/'; }
  catch (_) { return url.replace(/\/$/, '').toLowerCase() || '/'; }
}

function loadRows(f) { return JSON.parse(fs.readFileSync(f, 'utf8')).rows || []; }

function buildMap(rows) {
  const m = new Map();
  for (const r of rows) {
    const key = normUrl(r.page);
    if (!m.has(key)) m.set(key, r); // keep first (canonical, highest-traffic) entry
  }
  return m;
}

function sbPatch(urlFull, fields, retries = 2) {
  return new Promise((resolve, reject) => {
    const str = JSON.stringify(fields);
    const p = `/rest/v1/content?url_full=eq.${encodeURIComponent(urlFull)}`;
    const u = new URL(SUPABASE + p);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'PATCH',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(str), Prefer: 'return=minimal' },
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
  console.log('=== GSC WoW ENRICHMENT ===\n');
  const currRows = loadRows(FILE_CURR);
  const prevRows = loadRows(FILE_PREV);
  console.log(`Current week: ${currRows.length} pages | Previous week: ${prevRows.length} pages`);

  const currMap = buildMap(currRows);
  const prevMap = buildMap(prevRows);
  const allPaths = new Set([...currMap.keys(), ...prevMap.keys()]);
  console.log(`Unique pages: ${allPaths.size}\n`);

  let nUpdated = 0, nErrors = 0;

  const paths = [...allPaths];
  let ti = 0;
  async function worker() {
    while (ti < paths.length) {
      const pathKey = paths[ti++];
      const curr = currMap.get(pathKey);
      const prev = prevMap.get(pathKey);
      const update = {};
      if (curr) {
        update.gsc_clicks_wow   = curr.clicks;
        update.gsc_position_wow = Math.round(curr.position * 10) / 10;
      } else {
        update.gsc_clicks_wow   = 0;
        update.gsc_position_wow = prev ? Math.round(prev.position * 10) / 10 : null;
      }
      const fullUrl = pathKey === '/' ? 'https://passionates.com' : 'https://passionates.com' + pathKey;
      try {
        const s1 = await sbPatch(fullUrl, update);
        if (s1 >= 200 && s1 < 300) nUpdated++;
        else { nErrors++; if (nErrors <= 5) console.log(`  ERR ${s1}: ${fullUrl}`); }
      } catch (e) {
        nErrors++; if (nErrors <= 5) console.log(`  ERR ${e.code || e.message}: ${fullUrl}`);
      }
    }
  }
  await Promise.all(Array.from({ length: 12 }, () => worker()));

  console.log('\n=== DONE ===');
  console.log(`  Updated: ${nUpdated} | Errors: ${nErrors}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
