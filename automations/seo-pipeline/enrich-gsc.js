/**
 * GSC Performance Enrichment
 *
 * Reads three saved GSC query result files (full history, last 30 days, prev 30 days)
 * and populates these Supabase content columns:
 *   gsc_clicks, gsc_impressions, gsc_ctr, gsc_position  — from full history
 *   gsc_index_status                                     — 'INDEXED' for any page with impressions
 *   gsc_clicks_mom, clicks_delta, clicks_trend           — current vs prev 30-day clicks
 *   gsc_position_mom, position_delta, position_trend     — current vs prev 30-day position
 *
 * Matching: by url_full (normalised to strip trailing slash)
 *
 * Run: node C:/tools/enrich-gsc.js
 */
'use strict';
const fs    = require('fs');
const https = require('https');
const path  = require('path');

const SUPABASE = 'https://cjwwkmaiqsbgygqtjxel.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY_PASSIONATES;

// Fixed data directory — populated weekly by the weekly-seo-refresh scheduled task
const DATA_DIR    = 'C:\\tools\\data';
const FILE_FULL   = path.join(DATA_DIR, 'gsc-full.json');
const FILE_CURR30 = path.join(DATA_DIR, 'gsc-curr30.json');
const FILE_PREV30 = path.join(DATA_DIR, 'gsc-prev30.json');

function normUrl(url) {
  // Lowercase: GSC/GA4 report mixed-case silo paths (e.g. /Web-Design-Agency/...)
  // but content.url_full is stored lowercase. Without this, mixed-case reports
  // PATCH a non-existent url_full and silently no-op (204 on 0 rows matched).
  if (!url) return '';
  try { return new URL(url).pathname.replace(/\/$/, '').toLowerCase() || '/'; }
  catch (_) { return url.replace(/\/$/, '').toLowerCase() || '/'; }
}

function parseCtr(ctrStr) {
  // "2.60%" → 0.026
  return parseFloat((ctrStr || '0').replace('%', '')) / 100;
}

function loadRows(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const obj = JSON.parse(raw);
  return obj.rows || [];
}

function buildMap(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = normUrl(r.page);
    // Keep first occurrence only — GSC sorts by clicks desc, so canonical page
    // (highest traffic) comes before fragment variants (#h-...) of the same URL.
    // Overwriting would replace canonical stats with fragment stats.
    if (!map.has(key)) map.set(key, r);
  }
  return map;
}

function trend(delta) {
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'stable';
}

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
      } else {
        reject(err);
      }
    });
    // Abort a stalled socket (no response, no error) so the retry path fires —
    // otherwise a hung connection blocks the whole run indefinitely.
    req.setTimeout(20000, () => { const e = new Error('socket timeout'); e.code = 'ETIMEDOUT'; req.destroy(e); });
    req.write(str); req.end();
  });
}

async function main() {
  console.log('=== GSC PERFORMANCE ENRICHMENT ===\n');

  // Load all three datasets
  console.log('Loading GSC data files...');
  const fullRows  = loadRows(FILE_FULL);
  const curr30    = loadRows(FILE_CURR30);
  const prev30    = loadRows(FILE_PREV30);
  console.log(`  Full history: ${fullRows.length} pages`);
  console.log(`  Last 30 days: ${curr30.length} pages`);
  console.log(`  Prev 30 days: ${prev30.length} pages\n`);

  const fullMap   = buildMap(fullRows);
  const curr30Map = buildMap(curr30);
  const prev30Map = buildMap(prev30);

  // All unique page paths across all periods
  const allPaths = new Set([...fullMap.keys(), ...curr30Map.keys(), ...prev30Map.keys()]);
  console.log(`Total unique pages to process: ${allPaths.size}\n`);

  let nUpdated = 0, nErrors = 0;

  // Build the write list (pure CPU), then PATCH with bounded concurrency. Sequential awaits
  // over thousands of rows are ~300ms RTT each (~18 min for 3600 rows) and get killed by the
  // run-weekly step timeout mid-loop, leaving partial data. A pool keeps it to ~1-2 min.
  const tasks = [];
  for (const pathKey of allPaths) {
    const full = fullMap.get(pathKey);
    const curr = curr30Map.get(pathKey);
    const prev = prev30Map.get(pathKey);

    const update = {};
    if (full) {
      update.gsc_clicks      = full.clicks;
      update.gsc_impressions = full.impressions;
      update.gsc_ctr         = parseCtr(full.ctr);
      update.gsc_position    = Math.round(full.position * 10) / 10;
      update.gsc_index_status = 'INDEXED';
    } else if (curr || prev) {
      update.gsc_index_status = 'INDEXED';
    }
    if (curr || prev) {
      const currClicks = curr ? curr.clicks   : 0;
      const prevClicks = prev ? prev.clicks   : 0;
      const currPos    = curr ? curr.position : null;
      const prevPos    = prev ? prev.position : null;
      update.gsc_clicks_mom = currClicks;
      update.clicks_trend   = trend(currClicks - prevClicks);
      if (currPos !== null || prevPos !== null) {
        const cp = currPos !== null ? currPos : prevPos;
        const pp = prevPos !== null ? prevPos : currPos;
        update.gsc_position_mom = Math.round(cp * 10) / 10;
        const posDelta = Math.round((cp - pp) * 10) / 10;
        update.position_trend = posDelta < 0 ? 'up' : posDelta > 0 ? 'down' : 'stable';
      }
    }
    if (Object.keys(update).length === 0) continue;
    const fullUrl = pathKey === '/' ? 'https://passionates.com' : 'https://passionates.com' + pathKey;
    tasks.push({ fullUrl, update });
  }

  const CONC = 12;
  let ti = 0;
  async function worker() {
    while (ti < tasks.length) {
      const t = tasks[ti++];
      try {
        const status = await sbPatch(t.fullUrl, t.update);
        if (status >= 200 && status < 300) nUpdated++;
        else { nErrors++; if (nErrors <= 5) console.log(`  ERR ${status}: ${t.fullUrl}`); }
      } catch (e) {
        nErrors++; if (nErrors <= 5) console.log(`  ERR ${e.code || e.message}: ${t.fullUrl}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()));

  console.log('\n=== DONE ===');
  console.log(`  Updated : ${nUpdated}`);
  console.log(`  Errors  : ${nErrors}`);
  console.log(`  No match: ${tasks.length - nUpdated - nErrors}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
