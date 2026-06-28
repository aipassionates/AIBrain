/**
 * Resolve rank_math_primary_category from WP term IDs to human-readable names.
 * Uses the public WP REST API (no auth required).
 * Run: node C:\tools\fix-primary-category.js
 */
'use strict';
const https = require('https');

const WP_BASE  = 'https://passionates.com';
const SUPABASE = 'https://cjwwkmaiqsbgygqtjxel.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY_PASSIONATES;

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Accept: 'application/json' } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(d) }); } catch (_) { resolve({ status: res.statusCode, headers: res.headers, body: d }); } });
    }).on('error', reject);
  });
}

function sbRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const str = body ? JSON.stringify(body) : null;
    const u = new URL(SUPABASE + path);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: {
        apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`,
        Accept: 'application/json',
        ...(str ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(str) } : {}),
        ...(method === 'POST' ? { Prefer: 'resolution=merge-duplicates,return=minimal' } : {}),
      },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch (_) { resolve({ status: res.statusCode, body: d }); } });
    });
    req.on('error', reject);
    if (str) req.write(str);
    req.end();
  });
}

async function fetchAllTerms(endpoint) {
  const all = [];
  let page = 1;
  while (true) {
    const r = await get(`${WP_BASE}/wp-json/wp/v2/${endpoint}?per_page=100&page=${page}&_fields=id,name,slug`);
    if (r.status !== 200 || !Array.isArray(r.body)) break;
    all.push(...r.body);
    if (page >= parseInt(r.headers['x-wp-totalpages'] || '1', 10)) break;
    page++;
    await new Promise(res => setTimeout(res, 80));
  }
  return all;
}

async function main() {
  console.log('=== RESOLVE PRIMARY CATEGORY TERM IDs ===\n');

  // Build term ID → name map from all relevant taxonomies
  const idMap = new Map();
  for (const ep of ['categories', 'tags', 'industry', 'services', 'page-category']) {
    const terms = await fetchAllTerms(ep);
    for (const t of terms) idMap.set(String(t.id), t.name);
    console.log(`  ${ep}: ${terms.length} terms loaded`);
  }
  console.log(`  Total term map: ${idMap.size} entries\n`);

  // Fetch all content rows where rank_math_primary_category looks like a number
  let offset = 0;
  const toUpdate = [];
  while (true) {
    const r = await sbRequest('GET', `/rest/v1/content?select=id,url_full,rank_math_primary_category&rank_math_primary_category=not.is.null&limit=1000&offset=${offset}`);
    if (!Array.isArray(r.body)) { console.error('Fetch error:', JSON.stringify(r.body).slice(0,200)); break; }
    for (const row of r.body) {
      const val = row.rank_math_primary_category;
      if (/^\d+$/.test(val)) {
        // It's a raw term ID number — resolve it
        const name = idMap.get(val);
        if (name) toUpdate.push({ url_full: row.url_full, rank_math_primary_category: name });
        else toUpdate.push({ url_full: row.url_full, rank_math_primary_category: `[unresolved:${val}]` });
      }
    }
    if (r.body.length < 1000) break;
    offset += 1000;
  }

  console.log(`Rows with numeric primary_category: ${toUpdate.length}`);
  console.log('Sample:', toUpdate.slice(0, 5).map(r => `${r.url_full.slice(-40)} → "${r.rank_math_primary_category}"`).join('\n  '));

  // Update in batches
  let done = 0, errors = 0;
  for (const row of toUpdate) {
    const r = await sbRequest('POST', '/rest/v1/content?on_conflict=url_full', [row]);
    if (r.status >= 200 && r.status < 300) { done++; process.stdout.write('.'); }
    else { errors++; console.log(`\nERR: ${row.url_full} → ${r.status}`); }
    await new Promise(res => setTimeout(res, 30));
  }
  console.log(`\n\n  ${done} resolved, ${errors} errors`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
