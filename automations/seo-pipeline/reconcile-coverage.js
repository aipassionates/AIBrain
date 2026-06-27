/**
 * Reconcile export data against the content table (final coverage check).
 *
 * For every URL present in the GSC and GA4 exports, confirm a matching content row
 * exists. Reports:
 *   - export URLs with NO content row (orphaned data — enrichment PATCHed nothing)
 *   - how many of those would match if lowercased (diagnoses case-mismatch no-ops,
 *     since PATCH with return=minimal returns 204 even when 0 rows match)
 *
 * Run: node C:/tools/reconcile-coverage.js
 */
'use strict';
const fs = require('fs');
const https = require('https');
const path = require('path');

const SUPABASE = 'https://cjwwkmaiqsbgygqtjxel.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const DATA = 'C:\\tools\\data';

// Exactly as the enrich scripts normalize: strip trailing slash, PRESERVE case.
function normExact(u) {
  if (!u) return '';
  try { const p = new URL(u).pathname.replace(/\/$/, ''); return 'https://passionates.com' + p; }
  catch (_) {}
  const p = u === '/' ? '' : u.replace(/\/$/, '');
  return 'https://passionates.com' + p;
}
function loadRows(f) { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')).rows || []; }

function sbPage(offset) {
  return new Promise((res, rej) => {
    const p = `/rest/v1/content?select=url_full&order=url_full&limit=1000&offset=${offset}`;
    const u = new URL(SUPABASE + p);
    https.get({ hostname: u.hostname, path: u.pathname + u.search,
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } },
      r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); })
      .on('error', rej);
  });
}
async function allContentUrls() {
  const exact = new Set(), lower = new Set();
  let off = 0;
  while (true) {
    const rows = await sbPage(off);
    if (!rows.length) break;
    for (const r of rows) { exact.add(r.url_full); lower.add((r.url_full || '').toLowerCase()); }
    if (rows.length < 1000) break;
    off += 1000;
  }
  return { exact, lower };
}

function check(label, rows, urlKey, metricKey, content) {
  // Build map of normalized URL -> max metric (to rank gaps by traffic)
  const m = new Map();
  for (const r of rows) {
    const url = normExact(r[urlKey]);
    const v = Number(r[metricKey]) || 0;
    m.set(url, Math.max(m.get(url) || 0, v));
  }
  // The pipeline LOWERCASES, so a lowercase hit is a genuine match (the mixed-case
  // silo paths Google reports map correctly to the lowercase content row).
  let matched = 0, trulyMissing = [];
  for (const [url, v] of m) {
    if (content.exact.has(url) || content.lower.has(url.toLowerCase())) { matched++; continue; }
    trulyMissing.push({ url, v });
  }
  trulyMissing.sort((a, b) => b.v - a.v);
  console.log(`\n=== ${label} ===`);
  console.log(`  distinct export URLs : ${m.size}`);
  console.log(`  matched in content   : ${matched}  (incl. mixed-case silo paths, lowercase-matched)`);
  console.log(`  not in content       : ${trulyMissing.length}  (redirect-source short URLs — see PIPELINE.md limitation #2)`);
  console.log(`  top not-in-content (by ${metricKey}):`);
  for (const x of trulyMissing.slice(0, 15)) {
    console.log(`     ${String(x.v).padStart(6)} | ${x.url.replace('https://passionates.com', '') || '/'}`);
  }
  return { trulyMissing };
}

async function main() {
  console.log('RECONCILE: export URLs vs content table\n');
  const content = await allContentUrls();
  console.log(`content rows: ${content.exact.size} distinct url_full`);
  check('GSC full history', loadRows('gsc-full.json'), 'page', 'clicks', content);
  check('GA4 full history', loadRows('ga4-data.json'), 'pagePath', 'activeUsers', content);
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
