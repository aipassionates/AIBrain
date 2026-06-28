/**
 * Fetch all WP taxonomy terms (categories, tags, industry, services, page-category)
 * and insert them as content rows.
 * Also inserts special non-editable pages (llm-info.txt, sitemap.xml, etc.)
 * Run: node C:\tools\add-taxonomy-pages.js
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
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(d) }); }
        catch (_) { resolve({ status: res.statusCode, headers: res.headers, body: d }); }
      });
    }).on('error', reject);
  });
}

function sbPost(path, body) {
  return new Promise((resolve, reject) => {
    const str = JSON.stringify(body);
    const u = new URL(SUPABASE + path);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: {
        apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(str),
        Accept: 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }); } catch (_) { resolve({ status: res.statusCode, body: d }); } });
    });
    req.on('error', reject);
    req.write(str); req.end();
  });
}

function norm(url) { return url.replace(/\/$/, '').toLowerCase(); }

// Fetch all pages of a WP taxonomy endpoint
async function fetchAllTerms(restBase) {
  const all = [];
  let page = 1;
  while (true) {
    const r = await get(`${WP_BASE}/wp-json/wp/v2/${restBase}?per_page=100&page=${page}&_fields=id,slug,link,name,description,count,parent`);
    if (r.status !== 200 || !Array.isArray(r.body)) break;
    all.push(...r.body);
    const totalPages = parseInt(r.headers['x-wp-totalpages'] || '1', 10);
    if (page >= totalPages) break;
    page++;
    await new Promise(res => setTimeout(res, 100));
  }
  return all;
}

// Build content_source for taxonomy type
function sourceFor(restBase) {
  return 'taxonomy';
}

// Build wp_post_type equivalent for taxonomy
function typeFor(restBase) {
  if (restBase === 'categories') return 'category';
  if (restBase === 'tags') return 'tag';
  return restBase.replace(/-/g, '_');
}

async function run() {
  console.log('=== ADD TAXONOMY PAGES ===\n');

  const taxonomies = [
    { restBase: 'categories',       label: 'Post categories' },
    { restBase: 'tags',             label: 'Post tags' },
    { restBase: 'industry',         label: 'Industry taxonomy' },
    { restBase: 'services',         label: 'Services taxonomy' },
    { restBase: 'page-category',    label: 'Page categories' },
    { restBase: 'template-industry',label: 'Template industry' },
    { restBase: 'template-type',    label: 'Template type' },
    { restBase: 'product_cat',      label: 'Product categories' },
  ];

  const rows = [];

  for (const { restBase, label } of taxonomies) {
    const terms = await fetchAllTerms(restBase);
    console.log(`  ${label}: ${terms.length} terms`);
    for (const t of terms) {
      if (!t.link) continue;
      const url = norm(t.link);
      rows.push({
        url_full:        url,
        url_slug:        t.slug,
        wp_post_type:    typeFor(restBase),
        record_id:       String(t.id),
        title:           t.name,
        excerpt:         t.description || null,
        status:          t.count > 0 ? 'publish' : 'empty',
        content_source:  'taxonomy',
        is_editable:     false,
        include_in_analysis: t.count > 0,  // only include if it has content
        noindex:         false,
      });
    }
  }

  // Special non-CMS pages that appear in GSC
  const specialPages = [
    {
      url_full: 'https://passionates.com/llm-info.txt',
      url_slug: 'llm-info.txt',
      wp_post_type: 'document',
      title: 'LLM Info (AI bot file)',
      status: 'publish',
      content_source: 'document',
      is_editable: false,
      include_in_analysis: false,
      noindex: true,
    },
    {
      url_full: 'https://passionates.com/sitemap.xml',
      url_slug: 'sitemap.xml',
      wp_post_type: 'document',
      title: 'XML Sitemap',
      status: 'publish',
      content_source: 'system',
      is_editable: false,
      include_in_analysis: false,
      noindex: true,
    },
    {
      url_full: 'https://passionates.com/sitemap_index.xml',
      url_slug: 'sitemap_index.xml',
      wp_post_type: 'document',
      title: 'XML Sitemap Index',
      status: 'publish',
      content_source: 'system',
      is_editable: false,
      include_in_analysis: false,
      noindex: true,
    },
  ];
  rows.push(...specialPages);

  console.log(`\nTotal rows to upsert: ${rows.length}`);

  // Upsert in batches
  const BATCH = 50;
  let done = 0, errors = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const r = await sbPost('/rest/v1/content?on_conflict=url_full', batch);
    if (r.status >= 200 && r.status < 300) { done += batch.length; process.stdout.write('.'); }
    else { errors++; console.log(`\nERROR batch ${i}: ${r.status} ${JSON.stringify(r.body).slice(0,200)}`); }
    await new Promise(res => setTimeout(res, 100));
  }
  console.log(`\n\n  ${done} upserted, ${errors} errors`);

  // Verify
  console.log('\nVerifying taxonomy rows in DB...');
  // (verification via next query)
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
