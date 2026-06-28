/**
 * Detect JSON-LD schema types on live pages and populate schema_types column.
 * Fetches each published WP page, parses <script type="application/ld+json"> tags,
 * extracts @type values, and saves as an array in content.schema_types.
 *
 * This is more reliable than RankMath meta because it shows what Google actually sees,
 * including schema from Elementor, plugins, and WP themes.
 *
 * Run: node C:\tools\detect-schema-types.js
 */
'use strict';
const https = require('https');

const SUPABASE = 'https://cjwwkmaiqsbgygqtjxel.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY_PASSIONATES;
const CONCURRENCY = 5;  // simultaneous page fetches
const DELAY_MS    = 150;

function fetchUrl(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SchemaDetector/1.0)' },
      timeout: 15000,
    };
    https.get(options, res => {
      // Follow one redirect
      if (res.statusCode >= 301 && res.statusCode <= 302 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve);
      }
      if (res.statusCode !== 200) { res.resume(); return resolve({ status: res.statusCode, html: '' }); }
      let d = '';
      res.on('data', c => { d += c; if (d.length > 500_000) { res.destroy(); } });
      res.on('end', () => resolve({ status: res.statusCode, html: d }));
      res.on('error', () => resolve({ status: 0, html: '' }));
    }).on('error', () => resolve({ status: 0, html: '' }))
      .on('timeout', function() { this.destroy(); resolve({ status: 0, html: '' }); });
  });
}

function extractSchemaTypes(html) {
  const types = new Set();
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const obj = JSON.parse(m[1]);
      const nodes = obj['@graph'] ? obj['@graph'] : [obj];
      for (const node of nodes) {
        if (node['@type']) {
          const t = node['@type'];
          if (Array.isArray(t)) t.forEach(x => types.add(x));
          else types.add(t);
        }
      }
    } catch (_) {}
  }
  return [...types].sort();
}

function sbGet(path) {
  return new Promise((resolve, reject) => {
    const u = new URL(SUPABASE + path);
    https.get({ hostname: u.hostname, path: u.pathname + u.search,
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, Accept: 'application/json' }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (_) { resolve([]); } });
    }).on('error', reject);
  });
}

function sbPatch(urlFull, fields) {
  return new Promise((resolve, reject) => {
    const str = JSON.stringify(fields);
    const path = `/rest/v1/content?url_full=eq.${encodeURIComponent(urlFull)}`;
    const u = new URL(SUPABASE + path);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'PATCH',
      headers: {
        apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(str),
        Prefer: 'return=minimal',
      },
    }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.write(str); req.end();
  });
}

async function main() {
  console.log('=== SCHEMA TYPE DETECTION ===\n');

  // Fetch all published content rows (wordpress + taxonomy)
  const rows = [];
  let offset = 0;
  while (true) {
    const batch = await sbGet(
      `/rest/v1/content?select=url_full&status=eq.publish&content_source=in.(wordpress,taxonomy)&noindex=eq.false&schema_types=is.null&limit=500&offset=${offset}`
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    rows.push(...batch.map(r => r.url_full));
    if (batch.length < 500) break;
    offset += 500;
  }
  console.log(`URLs to scan: ${rows.length}\n`);

  let done = 0, withSchema = 0, errors = 0;

  // Process in chunks of CONCURRENCY
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async url => {
      const { status, html } = await fetchUrl(url);
      if (!html) { errors++; return; }
      const types = extractSchemaTypes(html);
      if (types.length > 0) {
        await sbPatch(url, { schema_types: types });
        withSchema++;
      }
      done++;
    }));
    if (i % 50 === 0) process.stdout.write(`  ${done}/${rows.length} (${withSchema} with schema)\r`);
    await new Promise(res => setTimeout(res, DELAY_MS));
  }

  console.log(`\n\n=== DONE: ${done} scanned, ${withSchema} have schema, ${errors} errors ===`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
