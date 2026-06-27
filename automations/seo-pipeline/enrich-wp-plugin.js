/**
 * WP SEO-Meta Enrichment — passionates/v1/seo-meta endpoint (functions.php token auth)
 *
 * Fields populated:
 *   seo_title, seo_description, seo_focus_keyword (RankMath)
 *   og_title, og_description, og_image_url (RankMath Facebook/OG + featured_image fallback)
 *   robots_directive, include_in_analysis (RankMath robots — now comma-separated strings)
 *   canonical_url (RankMath canonical override)
 *   sitemap_priority, sitemap_changefreq (RankMath sitemap)
 *   media_urls, media_type (youtube-url + enclosure/Buzzsprout)
 *   faq_items (question_1..7 / answer_1..7 ACF meta)
 *   seo_score (RankMath score 0-100)
 *   read_time (parsed from all_meta['read-time'])
 *   featured_image_url (WP featured image URL)
 *   schema_types (derived from rank_math_schema_* meta keys)
 *
 * Run: node C:\tools\enrich-wp-plugin.js
 * Requires: CLAUDE_SEO_TOKEN env var (set in User env vars)
 */
'use strict';
const https = require('https');

const WP_BASE  = 'https://passionates.com';
const SUPABASE = 'https://cjwwkmaiqsbgygqtjxel.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const WP_TOKEN = process.env.CLAUDE_SEO_TOKEN;

// Only process these WP post types — everything else (acf-field, elementor_library, etc.) is skipped
const CONTENT_TYPES = new Set(['post', 'page', 'careers', 'projects']);

if (!WP_TOKEN) {
  console.error('ERROR: CLAUDE_SEO_TOKEN env var not set.');
  console.error('Run: [Environment]::SetEnvironmentVariable("CLAUDE_SEO_TOKEN","<token>","User") in PowerShell');
  process.exit(1);
}

function wpGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(WP_BASE + path);
    https.get({
      hostname: url.hostname, path: url.pathname + url.search,
      headers: { Accept: 'application/json' },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(d) }); }
        catch (_) { resolve({ status: res.statusCode, headers: res.headers, body: d }); }
      });
    }).on('error', reject);
  });
}

// Match by WP post ID + content_source — avoids URL normalization issues
function sbPatch(wpPostId, fields) {
  return new Promise((resolve, reject) => {
    const str = JSON.stringify(fields);
    const path = `/rest/v1/content?cms_item_id=eq.${wpPostId}&content_source=eq.wordpress`;
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

function buildFaqItems(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const items = [];
  for (let i = 1; i <= 7; i++) {
    const q = (meta[`question_${i}`] || '').trim();
    const a = (meta[`answer_${i}`] || '').trim();
    if (q) items.push({ question: q, answer: a });
  }
  return items.length > 0 ? items : null;
}

async function main() {
  console.log('=== WP SEO-META ENRICHMENT ===\n');

  // Validate endpoint is up and auth works
  const test = await wpGet(`/wp-json/passionates/v1/seo-meta?token=${WP_TOKEN}&per_page=1&page=1`);
  if (test.status !== 200) {
    console.error(`ERROR: Endpoint returned ${test.status}`);
    if (test.status === 401 || test.status === 403) console.error('Check CLAUDE_SEO_TOKEN matches CLAUDE_SEO_TOKEN in wp-config.php');
    process.exit(1);
  }

  let page = 1;
  let totalPages = Infinity; // set from first real page response
  let nUpdated = 0, nSkipped = 0, nFiltered = 0, nErrors = 0;

  while (page <= totalPages) {
    const r = await wpGet(`/wp-json/passionates/v1/seo-meta?token=${WP_TOKEN}&per_page=100&page=${page}`);
    if (r.status !== 200 || !Array.isArray(r.body) || r.body.length === 0) break;

    // Set totalPages from first real per_page=100 response
    if (totalPages === Infinity) {
      totalPages = parseInt(r.headers['x-wp-totalpages'] || '1', 10);
      const totalPosts = parseInt(r.headers['x-wp-total'] || '0', 10);
      console.log(`Endpoint OK. ${totalPosts} total WP records across ${totalPages} pages.\n`);
    }

    for (const item of r.body) {
      // Skip internal WP post types — only enrich actual content
      if (!CONTENT_TYPES.has(item.post_type)) { nFiltered++; continue; }

      const rm   = item.rank_math || {};
      const meta = item.all_meta;
      const isObj = meta && typeof meta === 'object' && !Array.isArray(meta);

      const update = {};

      // RankMath SEO fields
      if (rm.title)         update.seo_title         = rm.title;
      if (rm.description)   update.seo_description   = rm.description;
      if (rm.focus_keyword) update.seo_focus_keyword = rm.focus_keyword;

      // Open Graph — use explicit Facebook override; fall back to featured image for og_image_url
      if (rm.facebook_title)       update.og_title       = rm.facebook_title;
      if (rm.facebook_description) update.og_description = rm.facebook_description;
      const ogImage = rm.facebook_image || item.featured_image_url;
      if (ogImage) update.og_image_url = ogImage;

      // Robots directive — now returns comma-separated string from PHP implode fix
      if (rm.robots) {
        const robotsStr = Array.isArray(rm.robots) ? rm.robots.join(',') : String(rm.robots);
        update.robots_directive = robotsStr;
        if (robotsStr.includes('noindex')) update.include_in_analysis = false;
      }

      // Featured image URL (Supabase column, not just og_image fallback)
      if (item.featured_image_url) update.featured_image_url = item.featured_image_url;

      // Read time — parse "25 min" → 25
      if (isObj) {
        const rtRaw = (meta['read-time'] || '').toString().trim();
        const rtMin = parseInt(rtRaw, 10);
        if (!isNaN(rtMin) && rtMin > 0) update.read_time = rtMin;
      }

      // Schema types — derive from which rank_math_schema_* keys exist in all_meta
      if (isObj) {
        const schemaTypes = Object.keys(meta)
          .filter(k => k.startsWith('rank_math_schema_'))
          .map(k => k.replace('rank_math_schema_', ''))
          .filter(t => !['metadata', 'type'].includes(t));
        if (schemaTypes.length > 0) update.schema_types = schemaTypes;
      }

      // Canonical URL override (only if explicitly set in RankMath)
      if (rm.canonical_url) update.canonical_url = rm.canonical_url;

      // Sitemap settings
      if (rm.sitemap_priority) update.sitemap_priority   = parseFloat(rm.sitemap_priority);
      if (rm.sitemap_freq)     update.sitemap_changefreq = rm.sitemap_freq;

      // RankMath SEO score (integer 0-100)
      const score = parseInt(rm.seo_score, 10);
      if (!isNaN(score)) update.seo_score = score;

      // Build media_urls from youtube-url and/or enclosure (Buzzsprout podcast)
      if (isObj) {
        const mediaEntries = [];
        const ytUrl = (meta['youtube-url'] || '').trim();
        if (ytUrl && !ytUrl.includes('{')) {
          mediaEntries.push({ platform: 'youtube', url: ytUrl, media_type: 'video' });
        }
        const encVal = meta['enclosure'];
        const encStr = Array.isArray(encVal) ? (encVal[0] || '') : (encVal || '');
        const podcastUrl = encStr.toString().trim().split('\n')[0].trim();
        if (podcastUrl && podcastUrl.startsWith('http')) {
          mediaEntries.push({ platform: 'buzzsprout', url: podcastUrl, media_type: 'podcast' });
        }
        if (mediaEntries.length > 0) {
          update.media_type = mediaEntries[0].media_type;
          update.media_urls = mediaEntries;
        }
      }

      // FAQ items from ACF question_1..7 / answer_1..7 meta fields
      if (isObj) {
        const faq = buildFaqItems(meta);
        if (faq) update.faq_items = faq;
      }

      if (Object.keys(update).length === 0) { nSkipped++; continue; }

      const status = await sbPatch(item.ID, update);
      if (status >= 200 && status < 300) {
        nUpdated++;
      } else {
        nErrors++;
        if (nErrors <= 10) console.log(`\n  ERR ${status}: WP ID ${item.ID} — ${item.permalink}`);
      }
      await new Promise(r => setTimeout(r, 30));
    }

    process.stdout.write(`  page ${page}/${totalPages} — updated: ${nUpdated}, filtered: ${nFiltered}, skipped: ${nSkipped}\r`);
    page++;
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n\n=== DONE ===`);
  console.log(`  Updated : ${nUpdated}`);
  console.log(`  Skipped : ${nSkipped} (no enrichable data)`);
  console.log(`  Filtered: ${nFiltered} (non-content post types)`);
  console.log(`  Errors  : ${nErrors}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
