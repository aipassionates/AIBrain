/**
 * Redirections Enrichment — passionates/v1/redirections endpoint
 *
 * Fetches all active RankMath redirections in one call, matches source URLs
 * against Supabase content.url_full, then sets:
 *   redirect_url    — destination URL
 *   redirect_type   — HTTP code as string ("301", "302", "410")
 *   include_in_analysis — false (redirected/gone content excluded)
 *
 * Also resolves the 36 duplicate cms_item_id pairs: the row whose url_full
 * matches a redirection source is the old URL — it gets tagged as redirected.
 *
 * Run: node C:\tools\enrich-redirections.js
 * Requires: CLAUDE_SEO_TOKEN env var
 */
'use strict';
const https = require('https');

const WP_BASE  = 'https://passionates.com';
const SUPABASE = 'https://cjwwkmaiqsbgygqtjxel.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const WP_TOKEN = process.env.CLAUDE_SEO_TOKEN;

if (!WP_TOKEN) { console.error('ERROR: CLAUDE_SEO_TOKEN not set'); process.exit(1); }

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Accept: 'application/json' } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch (_) { resolve({ status: res.statusCode, body: d }); }
      });
    }).on('error', reject);
  });
}

function sbGet(path) {
  return new Promise((resolve, reject) => {
    const u = new URL(SUPABASE + path);
    https.get({
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, Accept: 'application/json' },
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
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'PATCH',
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

function normPath(urlOrPath) {
  if (!urlOrPath) return '';
  // Ensure paths without a leading slash get one (RankMath stores patterns without it)
  const str = urlOrPath.startsWith('http')
    ? urlOrPath
    : 'https://passionates.com' + (urlOrPath.startsWith('/') ? '' : '/') + urlOrPath;
  try {
    const u = new URL(str);
    return u.pathname.replace(/\/$/, '') || '/';
  } catch (_) {
    const p = urlOrPath.startsWith('/') ? urlOrPath : '/' + urlOrPath;
    return p.replace(/\/$/, '') || '/';
  }
}

async function main() {
  console.log('=== REDIRECTIONS ENRICHMENT ===\n');

  // 1. Fetch all active redirections
  const r = await get(`${WP_BASE}/wp-json/passionates/v1/redirections?token=${WP_TOKEN}`);
  if (r.status !== 200 || !Array.isArray(r.body)) {
    console.error(`ERROR: ${r.status} — ${JSON.stringify(r.body).slice(0, 200)}`);
    process.exit(1);
  }
  const redirections = r.body;
  console.log(`Fetched ${redirections.length} active redirections from WP.\n`);

  // Check how many have sources
  const withSources = redirections.filter(rd => rd.sources && rd.sources.length > 0);
  const noSources   = redirections.filter(rd => !rd.sources || rd.sources.length === 0);
  console.log(`  With sources: ${withSources.length} | Empty sources: ${noSources.length}`);

  if (withSources.length === 0) {
    console.error('\nERROR: All redirections have empty sources.');
    console.error('The json_decode fix in functions.php redirections callback is likely not applied yet.');
    console.error('In functions.php, change: $sources = maybe_unserialize($row[\'sources\']);');
    console.error('To: $sources = json_decode($row[\'sources\'], true); if (!is_array($sources)) { $sources = maybe_unserialize($row[\'sources\']); }');
    process.exit(1);
  }

  // 2. Build path → {url_to, code} map (exact matches only for now)
  const redirectMap = new Map(); // normalised source path → {url_to, code}
  for (const rd of withSources) {
    for (const src of rd.sources) {
      // RankMath stores source path as 'pattern', not 'url'
      const pattern = src.pattern || src.url || '';
      if (!pattern) continue;
      if (src.comparison === 'exact' || src.comparison === 'exact_i') {
        const key = normPath(pattern);
        if (!redirectMap.has(key)) {
          redirectMap.set(key, { url_to: rd.url_to, code: String(rd.header_code) });
        }
      }
    }
  }
  console.log(`  Built redirect map with ${redirectMap.size} exact-match source paths.\n`);

  // 3. Fetch all Supabase content URLs (url_full + id)
  console.log('Fetching Supabase content URLs...');
  let sbRows = [];
  let sbPage = 0;
  const sbPageSize = 1000;
  while (true) {
    const chunk = await sbGet(
      `/rest/v1/content?select=id,url_full,redirect_url&limit=${sbPageSize}&offset=${sbPage * sbPageSize}`
    );
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    sbRows = sbRows.concat(chunk);
    if (chunk.length < sbPageSize) break;
    sbPage++;
  }
  console.log(`  Loaded ${sbRows.length} Supabase rows.\n`);

  // 4. Match and update
  let nUpdated = 0, nSkipped = 0, nErrors = 0, nAlreadySet = 0;

  for (const row of sbRows) {
    if (!row.url_full) { nSkipped++; continue; }

    const path = normPath(row.url_full);
    const match = redirectMap.get(path);

    if (!match) { nSkipped++; continue; }

    // Don't overwrite if already set to the same value
    if (row.redirect_url === match.url_to) { nAlreadySet++; continue; }

    const update = {
      redirect_url:        match.url_to,
      redirect_type:       match.code,
      include_in_analysis: false,
    };

    const status = await sbPatch(row.url_full, update);
    if (status >= 200 && status < 300) {
      nUpdated++;
    } else {
      nErrors++;
      if (nErrors <= 10) console.log(`  ERR ${status}: ${row.url_full} → ${match.url_to}`);
    }
    await new Promise(r => setTimeout(r, 20));
  }

  console.log('\n=== DONE ===');
  console.log(`  Updated   : ${nUpdated}`);
  console.log(`  Already OK: ${nAlreadySet}`);
  console.log(`  No match  : ${nSkipped}`);
  console.log(`  Errors    : ${nErrors}`);

  if (nUpdated > 0) {
    console.log('\nNext: verify with SELECT redirect_url, redirect_type, COUNT(*) FROM content WHERE redirect_url IS NOT NULL GROUP BY redirect_url, redirect_type ORDER BY COUNT(*) DESC LIMIT 10;');
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
