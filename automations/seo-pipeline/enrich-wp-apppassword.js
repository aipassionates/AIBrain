/**
 * WP App Password Enrichment — consolidated fallback / retest script
 *
 * Merges three prior scripts into one:
 *   1. App Password auth mode  (enrich-wp-auth.js)    — full meta access via WP REST API
 *   2. Public API mode         (enrich-wp-public.js)  — no auth, public fields only
 *   3. HTML scrape phase       (enrich-h1-text.js)    — h1_text + og:image gap fill
 *
 * USE CASE:
 *   The primary enrichment path is the token-auth endpoint (enrich-wp-plugin.js) which
 *   fetches RankMath/ACF data server-side. Use this script to:
 *     a) Test whether iThemes Security's Basic Auth block has been resolved
 *     b) Fill WP REST API fields not covered by the plugin (author, categories, tags, page_parent)
 *     c) Scrape h1_text / og:image as a fallback if needed
 *
 * MODES:
 *   AUTH_MODE = 'app-password'  — requires WP_USER_PASSIONATES + WP_APP_PASS_PASSIONATES env vars
 *                                  Provides: author, categories, tags, page_category, page_parent,
 *                                            rank_math_robots, canonical, youtube_url, FAQ (q/a 1-7)
 *   AUTH_MODE = 'public'        — no credentials needed
 *                                  Provides: author, categories, tags, page_category, page_parent
 *                                  NOTE: meta fields (robots, canonical, FAQ) require auth
 *
 * SCRAPE_PHASE (boolean):
 *   When true, runs a second pass scraping live HTML for h1_text + og:image gap fill.
 *   Works regardless of AUTH_MODE.
 *
 * iThemes Security note:
 *   iThemes Security blocks Basic Auth headers by default. To enable App Password mode:
 *     WP Admin → Security → Advanced → Allow REST API Basic Auth Authentication
 *   Once fixed, switch AUTH_MODE to 'app-password' and verify with the auth test at startup.
 *
 * Run: node C:/tools/enrich-wp-apppassword.js
 */
'use strict';
const https = require('https');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const AUTH_MODE   = 'app-password'; // 'app-password' | 'public'
const SCRAPE_PHASE = false;          // set true to run HTML scrape pass after API pass

const WP_BASE    = 'https://passionates.com';
const WP_USER    = process.env.WP_USER_PASSIONATES;
const WP_PASS    = process.env.WP_APP_PASS_PASSIONATES;
const SUPABASE   = 'https://cjwwkmaiqsbgygqtjxel.supabase.co';
const ANON_KEY   = process.env.SUPABASE_ANON_KEY;

// ─── SHARED HELPERS ───────────────────────────────────────────────────────────
function norm(url) { return url ? url.replace(/\/$/, '').toLowerCase() : null; }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function sbPatch(urlFull, fields) {
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
    req.on('error', reject);
    req.write(str); req.end();
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

// ─── WP REST API ─────────────────────────────────────────────────────────────
function wpGet(path, useAuth) {
  return new Promise((resolve, reject) => {
    const url = new URL(WP_BASE + path);
    const headers = { Accept: 'application/json' };
    if (useAuth) {
      const WP_AUTH = Buffer.from(`${WP_USER}:${WP_PASS}`).toString('base64');
      headers.Authorization = `Basic ${WP_AUTH}`;
    }
    https.get({ hostname: url.hostname, path: url.pathname + url.search, headers }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(d) }); }
        catch (_) { resolve({ status: res.statusCode, headers: res.headers, body: d }); }
      });
    }).on('error', reject);
  });
}

async function buildTermMap(useAuth) {
  const map = new Map();
  for (const ep of ['categories', 'tags', 'industry', 'services', 'page-category',
                    'template-industry', 'template-type', 'product_cat']) {
    let page = 1;
    while (true) {
      const r = await wpGet(`/wp-json/wp/v2/${ep}?per_page=100&page=${page}&_fields=id,name`, useAuth);
      if (r.status !== 200 || !Array.isArray(r.body)) break;
      r.body.forEach(t => map.set(t.id, t.name));
      if (page >= parseInt(r.headers['x-wp-totalpages'] || '1', 10)) break;
      page++;
      await delay(80);
    }
  }
  return map;
}

async function fetchAllWP(postType, useAuth) {
  const all = [];
  let page = 1;
  while (true) {
    const context = useAuth ? '&context=edit' : '';
    const r = await wpGet(
      `/wp-json/wp/v2/${postType}?per_page=100&page=${page}&status=any${context}&_embed=true`,
      useAuth
    );
    if (r.status !== 200 || !Array.isArray(r.body)) break;
    all.push(...r.body);
    if (page >= parseInt(r.headers['x-wp-totalpages'] || '1', 10)) break;
    page++;
    await delay(100);
  }
  return all;
}

function buildUpdate(wp, termMap, recordIdToUrl, useAuth) {
  const url = norm(wp.link);
  if (!url) return null;

  const update = {};

  // Author — available in both modes via _embed
  const authorName = wp._embedded?.['author']?.[0]?.name;
  if (authorName) update.author = authorName;

  // Featured image — available in both modes via _embed
  const imageUrl = wp._embedded?.['wp:featuredmedia']?.[0]?.source_url;
  if (imageUrl) update.featured_image_url = imageUrl;

  // Categories — available in both modes
  if (Array.isArray(wp.categories) && wp.categories.length > 0) {
    const names = wp.categories.map(id => termMap.get(id)).filter(Boolean);
    if (names.length) update.categories = names;
  }

  // Tags — available in both modes
  if (Array.isArray(wp.tags) && wp.tags.length > 0) {
    const names = wp.tags.map(id => termMap.get(id)).filter(Boolean);
    if (names.length) update.tags = names;
  }

  // page-category — available in both modes
  const pageCatIds = wp['page-category'];
  if (Array.isArray(pageCatIds) && pageCatIds.length > 0) {
    const name = termMap.get(pageCatIds[0]);
    if (name) update.page_category = name;
  }

  // page_parent — resolve WP parent ID to URL
  if (wp.parent && wp.parent !== 0) {
    const parentUrl = recordIdToUrl.get(String(wp.parent));
    if (parentUrl) update.page_parent = parentUrl;
  }

  // ── App Password only: meta fields ──────────────────────────────────────
  if (useAuth) {
    const meta = wp.meta || {};

    // RankMath robots directive
    if (meta.rank_math_robots !== undefined && meta.rank_math_robots !== null) {
      const robots = Array.isArray(meta.rank_math_robots)
        ? meta.rank_math_robots.join(',')
        : String(meta.rank_math_robots);
      if (robots && robots !== 'index' && robots !== '') {
        update.rank_math_robots = robots;
        if (robots.includes('noindex')) update.noindex = true;
      }
    }

    // RankMath canonical override
    if (meta.rank_math_canonical_url && norm(meta.rank_math_canonical_url) !== url) {
      update.rank_math_canonical_url = meta.rank_math_canonical_url;
    }

    // YouTube URL (RankMath video snippet)
    const ytUrl = meta.rank_math_snippet_youtube_url;
    if (ytUrl) update.youtube_url = ytUrl;

    // RankMath FAQ (flat meta keys question_1..7 / answer_1..7)
    for (let i = 1; i <= 7; i++) {
      const q = meta[`rank_math_faq_question_${i}`];
      const a = meta[`rank_math_faq_answer_${i}`];
      if (q) update[`question_${i}`] = String(q);
      if (a) update[`answer_${i}`] = String(a);
    }
  }

  return Object.keys(update).length ? { url_full: url, ...update } : null;
}

// ─── API ENRICHMENT PHASE ────────────────────────────────────────────────────
async function runApiPhase() {
  const useAuth = AUTH_MODE === 'app-password';
  console.log(`\n── Phase 1: WP REST API (${AUTH_MODE} mode) ──\n`);

  if (useAuth) {
    if (!WP_USER || !WP_PASS) {
      console.error('ERROR: Set WP_USER_PASSIONATES and WP_APP_PASS_PASSIONATES env vars.');
      console.error('Switching to public mode...\n');
      return runApiPhase_public();
    }
    const test = await wpGet('/wp-json/wp/v2/users/me', true);
    if (test.status !== 200) {
      console.error(`Auth test FAILED (${test.status}): ${JSON.stringify(test.body).slice(0, 200)}`);
      console.error('iThemes Security is likely blocking Basic Auth.');
      console.error('Fix: WP Admin → Security → Advanced → Allow REST API Basic Auth Authentication');
      console.error('Falling back to public mode...\n');
      return runApiPhase_public();
    }
    console.log(`Authenticated as: ${test.body.name} (${test.body.roles?.join(', ')})\n`);
  }

  return runApiPhase_core(useAuth);
}

async function runApiPhase_public() {
  console.log('Running in PUBLIC mode (no auth — meta fields unavailable).\n');
  return runApiPhase_core(false);
}

async function runApiPhase_core(useAuth) {
  console.log('Building term map...');
  const termMap = await buildTermMap(useAuth);
  console.log(`  ${termMap.size} terms\n`);

  const skip = new Set([
    'attachment', 'nav_menu_item', 'wp_block', 'wp_template', 'wp_template_part',
    'wp_navigation', 'rank_math_schema', 'jp_pay_order', 'jp_pay_product',
    'oembed_cache', 'user_request', 'wp_global_styles', 'wp_css_layer',
  ]);
  const typesResp = await wpGet('/wp-json/wp/v2/types', useAuth);
  const postTypes = Object.values(typesResp.body)
    .filter(t => t.rest_base && !skip.has(t.slug))
    .map(t => t.rest_base);
  console.log('Post types:', postTypes.join(', '), '\n');

  console.log('Fetching all posts...');
  const allPosts = [];
  for (const pt of postTypes) {
    const posts = await fetchAllWP(pt, useAuth);
    allPosts.push(...posts);
    process.stdout.write(`  ${pt}:${posts.length} `);
  }
  console.log(`\n  Total: ${allPosts.length}\n`);

  const recordIdToUrl = new Map();
  for (const wp of allPosts) {
    if (wp.id && wp.link) recordIdToUrl.set(String(wp.id), norm(wp.link));
  }

  const byType = new Map();
  for (const wp of allPosts) {
    const t = wp.type || 'unknown';
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push(wp);
  }

  let totalUpdated = 0, totalSkipped = 0, totalErrors = 0;

  for (const [type, posts] of byType) {
    let updated = 0;
    for (const wp of posts) {
      const upd = buildUpdate(wp, termMap, recordIdToUrl, useAuth);
      if (!upd) { totalSkipped++; continue; }
      const { url_full, ...fields } = upd;
      const status = await sbPatch(url_full, fields);
      if (status >= 200 && status < 300) { updated++; totalUpdated++; }
      else {
        totalErrors++;
        if (totalErrors <= 10) console.log(`  ERR ${status}: ${url_full}`);
      }
      await delay(25);
    }
    console.log(`${type}: ${updated}/${posts.length} updated`);
  }

  console.log(`\nAPI phase: ${totalUpdated} updated | ${totalSkipped} no new data | ${totalErrors} errors`);
  if (useAuth) {
    console.log('\nApply noindex flags after run:');
    console.log("  UPDATE content SET include_in_analysis=false WHERE rank_math_robots LIKE '%noindex%';");
  } else {
    console.log('\nMeta fields (robots, canonical, youtube_url, FAQ) were NOT populated.');
    console.log('Fix iThemes Security Basic Auth block, then re-run with AUTH_MODE = "app-password".');
  }
}

// ─── HTML SCRAPE PHASE ───────────────────────────────────────────────────────
async function runScrapePhase() {
  console.log('\n── Phase 2: HTML Scrape (h1_text + og:image gap fill) ──\n');
  const CONCURRENCY = 5;
  const DELAY_MS = 150;

  // Only scrape published WP + taxonomy rows still missing h1_text
  const rows = [];
  let offset = 0;
  while (true) {
    const batch = await sbGet(
      `/rest/v1/content?select=url_full,featured_image_url&content_source=in.(wordpress,taxonomy)&h1_text=is.null&limit=500&offset=${offset}`
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < 500) break;
    offset += 500;
  }
  console.log(`URLs to scrape: ${rows.length}\n`);

  let done = 0, withH1 = 0, withOgImg = 0, errors = 0;

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async row => {
      const { url_full, featured_image_url } = row;
      const { status, html } = await fetchHtml(url_full);
      if (!html) { errors++; done++; return; }
      const update = {};
      const h1 = extractH1(html);
      if (h1) { update.h1_text = h1; withH1++; }
      if (!featured_image_url) {
        const ogImg = extractOgImage(html);
        if (ogImg) { update.og_image_url = ogImg; withOgImg++; }
      }
      if (Object.keys(update).length > 0) await sbPatch(url_full, update);
      done++;
    }));
    if (i % 50 === 0) process.stdout.write(`  ${done}/${rows.length} (h1:${withH1}, og:${withOgImg})\r`);
    await delay(DELAY_MS);
  }
  console.log(`\nScrape phase: ${withH1} h1_text | ${withOgImg} og:image | ${errors} errors`);
}

function fetchHtml(url) {
  return new Promise(resolve => {
    const u = new URL(url);
    https.get({
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PassionatesBot/1.0)' },
      timeout: 15000,
    }, res => {
      if (res.statusCode >= 301 && res.statusCode <= 302 && res.headers.location) {
        return fetchHtml(res.headers.location).then(resolve);
      }
      if (res.statusCode !== 200) { res.resume(); return resolve({ status: res.statusCode, html: '' }); }
      let d = '';
      res.on('data', c => { d += c; if (d.length > 300_000) res.destroy(); });
      res.on('end', () => resolve({ status: res.statusCode, html: d }));
      res.on('error', () => resolve({ status: 0, html: '' }));
    }).on('error', () => resolve({ status: 0, html: '' }))
      .on('timeout', function () { this.destroy(); resolve({ status: 0, html: '' }); });
  });
}

function extractH1(html) {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return null;
  return m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || null;
}

function extractOgImage(html) {
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
         || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return m ? m[1] : null;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== WP APP PASSWORD ENRICHMENT ===');
  console.log(`Mode: ${AUTH_MODE} | Scrape phase: ${SCRAPE_PHASE}\n`);
  await runApiPhase();
  if (SCRAPE_PHASE) await runScrapePhase();
  console.log('\n=== ALL DONE ===');
}

main().catch(e => { console.error('Fatal:', e.message, e.stack); process.exit(1); });
