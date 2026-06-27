/**
 * Fetch rank_math fields from the passionates/v1/seo-meta endpoint
 * and null-fill them into the Supabase content table.
 *
 * Run: node C:\tools\import-rankmath-api.js
 * Requires env: CLAUDE_SEO_TOKEN
 */

const https = require('https');

const WP_BASE    = 'https://passionates.com';
const TOKEN      = process.env.CLAUDE_SEO_TOKEN;
const SUPABASE   = 'https://cjwwkmaiqsbgygqtjxel.supabase.co';
const ANON_KEY   = process.env.SUPABASE_ANON_KEY;
const BATCH_SIZE = 100;

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { Accept: 'application/json' }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(d) }));
    }).on('error', reject).end();
  });
}

function sbRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const u    = new URL(SUPABASE + path);
    const str  = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: {
        apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, Accept: 'application/json',
        ...(str ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(str) } : {}),
        ...(method === 'POST' ? { Prefer: 'resolution=merge-duplicates,return=minimal' } : {}),
      },
    };
    const req = https.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch(_) { resolve({ status: res.statusCode, body: d }); } });
    });
    req.on('error', reject);
    if (str) req.write(str);
    req.end();
  });
}

// ── Fetch all pages from endpoint ─────────────────────────────────────────────

async function fetchAllRankMath() {
  const all = [];
  let page = 1, totalPages = 1;
  while (page <= totalPages) {
    const url = `${WP_BASE}/wp-json/passionates/v1/seo-meta?per_page=500&page=${page}&token=${TOKEN}`;
    process.stdout.write(`  Fetching page ${page}/${totalPages}...\r`);
    const resp = await get(url);
    if (resp.status !== 200) throw new Error(`API page ${page}: HTTP ${resp.status}`);
    if (page === 1) totalPages = parseInt(resp.headers['x-wp-totalpages'] || '1', 10);
    all.push(...resp.body);
    page++;
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`  Fetched ${all.length} rows from WP                    `);
  return all;
}

// ── Fetch existing DB rank_math values ────────────────────────────────────────

async function fetchExistingDB() {
  const byUrl      = new Map();   // url_full (normalised) → row
  const byRecordId = new Map();   // record_id (WP post ID) → row
  const cols = 'url_full,url_slug,wp_post_type,record_id,rank_math_focus_keyword,rank_math_title,rank_math_description,rank_math_seo_score,rank_math_pillar_content,rank_math_rich_snippet,rank_math_primary_category';
  let offset = 0;
  while (true) {
    const resp = await sbRequest('GET', `/rest/v1/content?select=${cols}&offset=${offset}&limit=1000`);
    if (!Array.isArray(resp.body)) throw new Error(`DB fetch: ${JSON.stringify(resp.body).substring(0,200)}`);
    for (const row of resp.body) {
      if (row.url_full) byUrl.set(row.url_full.replace(/\/$/, '').toLowerCase(), row);
      if (row.record_id) byRecordId.set(String(row.record_id), row);
    }
    if (resp.body.length < 1000) break;
    offset += 1000;
  }
  return { byUrl, byRecordId };
}

// ── Build update rows — null-fill only ───────────────────────────────────────

function buildUpdates(wpRows, { byUrl, byRecordId }) {
  const updates   = [];
  const conflicts = [];
  const seen      = new Set();   // dedupe by url_full
  const fieldMap  = {
    focus_keyword:    'rank_math_focus_keyword',
    seo_title:        'rank_math_title',
    meta_description: 'rank_math_description',
    seo_score:        'rank_math_seo_score',
    pillar_content:   'rank_math_pillar_content',
    rich_snippet:     'rank_math_rich_snippet',
    primary_category: 'rank_math_primary_category',
  };

  let matched = 0, notInDB = 0;

  for (const wp of wpRows) {
    // 1. Try guid (often the permalink)
    const guid = (wp.guid || '').replace(/\/$/, '').toLowerCase();
    // 2. Try constructed URLs
    const bySlug     = `${WP_BASE}/${wp.slug}`.toLowerCase();
    const byCptSlug  = `${WP_BASE}/${wp.post_type}/${wp.slug}`.toLowerCase();
    // 3. Try record_id (WP post ID stored during import-wp-merge)
    const byId       = byRecordId.get(String(wp.ID));

    const dbRow = byUrl.get(guid)
      || byUrl.get(bySlug)
      || byUrl.get(byCptSlug)
      || byId;

    if (!dbRow) { notInDB++; continue; }

    // Dedupe: if two WP rows match the same DB url, only process first
    const key = dbRow.url_full;
    if (seen.has(key)) continue;
    seen.add(key);
    matched++;

    const row = { url_full: dbRow.url_full, wp_post_type: dbRow.wp_post_type };
    let hasNew = false;

    for (const [wpField, dbCol] of Object.entries(fieldMap)) {
      const wpVal = wp[wpField];
      if (wpVal === null || wpVal === undefined || wpVal === '') continue;

      // Coerce types
      let coerced;
      if (dbCol === 'rank_math_seo_score')     coerced = parseInt(wpVal, 10) || null;
      else if (dbCol === 'rank_math_pillar_content') coerced = wpVal === '1' || wpVal === 'on' || wpVal === 'true';
      else coerced = String(wpVal).trim() || null;
      if (coerced === null) continue;

      const dbVal = dbRow[dbCol];
      const isEmpty = dbVal === null || dbVal === undefined || dbVal === '' || dbVal === false;

      // Always apply WP value (WP is authoritative for rank_math fields)
      row[dbCol] = coerced;
      hasNew = true;
      if (!isEmpty) {
        const same = String(dbVal).trim() === String(coerced).trim();
        if (!same) conflicts.push({ url: dbRow.url_full, field: dbCol, db: String(dbVal).substring(0,80), wp: String(coerced).substring(0,80) });
      }
    }
    if (hasNew) updates.push(row);
  }
  return { updates, conflicts, matched, notInDB };
}

// ── Upsert ────────────────────────────────────────────────────────────────────

function normalise(rows) {
  const keys = new Set(); rows.forEach(r => Object.keys(r).forEach(k => keys.add(k)));
  const ks = [...keys];
  return rows.map(r => { const o = {}; ks.forEach(k => { o[k] = r[k] !== undefined ? r[k] : null; }); return o; });
}

async function upsertAll(rows) {
  if (!rows.length) { console.log('  Nothing to upsert.'); return; }
  const batches = Math.ceil(rows.length / BATCH_SIZE);
  let done = 0, errors = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch   = normalise(rows.slice(i, i + BATCH_SIZE));
    const batchNo = Math.floor(i / BATCH_SIZE) + 1;
    process.stdout.write(`  Batch ${batchNo}/${batches}... `);
    const resp = await sbRequest('POST', '/rest/v1/content?on_conflict=url_full', batch);
    if (resp.status >= 200 && resp.status < 300) { done += batch.length; console.log('OK'); }
    else { errors++; console.log(`ERROR ${resp.status}: ${JSON.stringify(resp.body).substring(0,150)}`); }
    await new Promise(r => setTimeout(r, 100));
  }
  console.log(`  ${done} rows updated, ${errors} errors\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!TOKEN) { console.error('CLAUDE_SEO_TOKEN not set'); process.exit(1); }
  console.log('=== RANK_MATH IMPORT VIA API ===\n');

  console.log('Step 1: Fetching rank_math data from WP...');
  const wpRows = await fetchAllRankMath();

  console.log('\nStep 2: Fetching existing DB values...');
  const dbMap = await fetchExistingDB();
  console.log(`  ${dbMap.byUrl.size} DB rows loaded (${dbMap.byRecordId.size} with record_id)`);

  console.log('\nStep 3: Building null-fill updates...');
  const { updates, conflicts, matched, notInDB } = buildUpdates(wpRows, dbMap);

  console.log(`  WP rows matched to DB: ${matched}`);
  console.log(`  WP rows not in DB:     ${notInDB} (CPTs not yet imported)`);
  console.log(`  Rows with new data:    ${updates.length}`);
  console.log(`  Conflicting fields:    ${conflicts.length} (skipped — existing DB value kept)`);

  if (conflicts.length) {
    console.log('\n  ⚠️  Conflicts (DB differs from WP — NOT changed):');
    conflicts.slice(0, 20).forEach(c =>
      console.log(`    [${c.field}] ${c.url}\n      DB: ${c.db}\n      WP: ${c.wp}`)
    );
    if (conflicts.length > 20) console.log(`    ...and ${conflicts.length - 20} more`);
    require('fs').writeFileSync(
      `C:/Users/user/Downloads/rankmath-conflicts-${new Date().toISOString().slice(0,10)}.json`,
      JSON.stringify(conflicts, null, 2)
    );
    console.log('  Full conflict list saved to Downloads folder.');
  }

  console.log('\nStep 4: Upserting to Supabase...');
  await upsertAll(updates);

  console.log('=== COMPLETE ===');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
