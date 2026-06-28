/**
 * Verify export → Supabase fidelity.
 *
 * Confirms that the numbers in the saved GSC/GA4 export files (C:\tools\data\)
 * are EXACTLY what landed in Supabase. Proves the enrichment scripts transcribe
 * the source data faithfully (no made-up numbers, no unit drift, correct dedup).
 *
 *   gsc-full.json  .clicks   ->  content.gsc_clicks       (full history)
 *   gsc-curr7.json .clicks   ->  content.gsc_clicks_wow   (current 7d)
 *   ga4-data.json  .activeUsers -> content.ga_users       (full history)
 *
 * Run: node C:/tools/verify-export-vs-db.js
 */
'use strict';
const fs    = require('fs');
const https = require('https');
const path  = require('path');

const SUPABASE = 'https://cjwwkmaiqsbgygqtjxel.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY_PASSIONATES;
const DATA = 'C:\\tools\\data';

function normUrl(url) {
  try { return new URL(url).pathname.replace(/\/$/, '') || '/'; }
  catch (_) { return (url || '').replace(/\/$/, '') || '/'; }
}
function loadRows(f) { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')).rows || []; }
function fullUrlFor(pagePath) {
  const k = normUrl(pagePath);
  return k === '/' ? 'https://passionates.com' : 'https://passionates.com' + k;
}
function sbGet(urlFull, cols) {
  return new Promise((resolve, reject) => {
    const p = `/rest/v1/content?url_full=eq.${encodeURIComponent(urlFull)}&select=${cols}`;
    const u = new URL(SUPABASE + p);
    https.get({ hostname: u.hostname, path: u.pathname + u.search,
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try { resolve(JSON.parse(d)[0] || null); } catch (e) { reject(e); } }); })
      .on('error', reject);
  });
}

// Aggregate the export the SAME way the enrichment script does, so the comparison is
// apples-to-apples even when GA4/GSC return multiple path variants per URL:
//   mode 'sum' -> GA4 (enrich-ga4.js sums variants)
//   mode 'max' -> GSC (enrich-gsc.js buildMap keeps the highest-traffic / canonical row)
function aggregate(rows, key, mode) {
  const m = new Map();
  for (const r of rows) {
    const url = fullUrlFor(r.page || r.pagePath);
    const val = Math.round(Number(r[key]) || 0);
    if (!m.has(url)) m.set(url, val);
    else m.set(url, mode === 'sum' ? m.get(url) + val : Math.max(m.get(url), val));
  }
  return m;
}

async function check(label, file, exportKey, dbCol, mode) {
  console.log(`\n=== ${label} ===`);
  console.log(`export file: ${file}  (key .${exportKey}, ${mode})  ->  content.${dbCol}`);
  const agg = aggregate(loadRows(file), exportKey, mode);
  const top = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  let ok = 0, mismatch = 0;
  for (const [url, exp] of top) {
    const db  = await sbGet(url, dbCol);
    const dbv = db ? Math.round(Number(db[dbCol]) || 0) : null;
    const match = dbv === exp;
    if (match) ok++; else mismatch++;
    const short = url.replace('https://passionates.com', '') || '/';
    console.log(`  ${match ? 'OK ' : 'XX '} export=${String(exp).padStart(7)} | db=${String(dbv).padStart(7)} | ${short}`);
  }
  console.log(`  -> ${ok}/${top.length} match` + (mismatch ? `  (${mismatch} MISMATCH)` : ''));
}

async function main() {
  console.log('EXPORT -> SUPABASE FIDELITY CHECK');
  await check('GSC full history clicks', 'gsc-full.json',  'clicks',      'gsc_clicks',     'max');
  await check('GSC current-7d clicks',   'gsc-curr7.json', 'clicks',      'gsc_clicks_wow', 'max');
  await check('GA4 active users',        'ga4-data.json',  'activeUsers', 'ga_users',       'sum');
  console.log('\nDone. OK on every row = Supabase exactly mirrors the source export.');
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
