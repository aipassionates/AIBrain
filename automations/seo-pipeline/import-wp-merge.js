/**
 * Comprehensive WP → Supabase merge.
 *
 * For every published WP page and post, updates the DB with the live WP values for:
 *   - title (rendered — fixes HTML entities, IT capitalisation, slashes)
 *   - record_id (WP post ID — 1,613 pages currently missing this)
 *   - status, date_published, date_modified
 *   - excerpt (rendered)
 *   - featured_image_url
 *   - keyword, question_1-6, answer_1-6, hyperlink_1-5 (WP custom meta)
 *   - content_html + content_text  ← ONLY where currently NULL in DB
 *
 * Does NOT touch: rank_math_* (needs edit_posts role), content_html where already set,
 *   draft_html, page_category, read_time, youtube_url, question_7/answer_7.
 *
 * NOTE on rank_math: add "edit_posts" and "edit_pages" capabilities to the ClaudeAI
 *   role in WP Admin → Users → Roles, then re-run import-wp-auth.js.
 *
 * Requires env vars:
 *   WP_USER_PASSIONATES, WP_APP_PASS_PASSIONATES
 *
 * Run: node C:\tools\import-wp-merge.js
 */

const https = require('https');

// ── Config ────────────────────────────────────────────────────────────────────

const WP_BASE = 'https://passionates.com';
const WP_USER = process.env.WP_USER_PASSIONATES;
const WP_PASS = process.env.WP_APP_PASS_PASSIONATES;
const WP_AUTH = Buffer.from(`${WP_USER}:${WP_PASS}`).toString('base64');

const SUPABASE = 'https://cjwwkmaiqsbgygqtjxel.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY_PASSIONATES;

const PER_PAGE   = 100;
const BATCH_SIZE = 50;

// ── HTTP ──────────────────────────────────────────────────────────────────────

function request(urlStr, method, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Node.js WP-Merge/1.0',
        ...extraHeaders,
      },
    };
    if (body) {
      opts.headers['Content-Type']   = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(d) }); }
        catch (_) { resolve({ status: res.statusCode, headers: res.headers, body: d }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const wpGet  = url => request(url, 'GET', null, { Authorization: `Basic ${WP_AUTH}` });
const sbGet  = url => request(url, 'GET', null, { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` });
const sbPost = (url, rows) => request(url, 'POST', JSON.stringify(rows), {
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  Prefer: 'resolution=merge-duplicates,return=minimal',
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function ns(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function cleanUrl(link) {
  return link ? link.replace(/\/$/, '') : null;
}

function stripHtml(html) {
  if (!html) return null;
  const t = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ').trim();
  return t.length ? t : null;
}

function decodeTitle(rendered) {
  if (!rendered) return null;
  return rendered
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .trim();
}

function stripExcerpt(rendered) {
  if (!rendered) return null;
  return rendered.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
}

// ── WP: fetch all items of a type (paginated, with auth) ─────────────────────

async function fetchWPAll(type) {
  const items = [];
  let page = 1;
  while (true) {
    const url = `${WP_BASE}/wp-json/wp/v2/${type}?per_page=${PER_PAGE}&page=${page}`
      + `&status=publish`
      + `&_fields=id,link,title,status,date,modified,excerpt,content,meta,featured_media`
      + `&_embed=wp:featuredmedia`;
    const resp = await wpGet(url);
    if (resp.status === 400 && resp.body?.code === 'rest_post_invalid_page_number') break;
    if (!Array.isArray(resp.body)) {
      throw new Error(`WP ${type} p${page} (${resp.status}): ${JSON.stringify(resp.body).substring(0, 200)}`);
    }
    if (resp.body.length === 0) break;
    items.push(...resp.body);
    const total = parseInt(resp.headers['x-wp-total'] || '0', 10);
    process.stdout.write(`    fetched ${items.length}/${total} ${type}...\r`);
    if (items.length >= total) break;
    page++;
    await new Promise(r => setTimeout(r, 100));
  }
  console.log();
  return items;
}

// ── Supabase: fetch all URLs that currently have NULL content_html ────────────

async function fetchNullContentUrls() {
  const urls = new Set();
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const url = `${SUPABASE}/rest/v1/content?content_html=is.null&select=url_full&offset=${offset}&limit=${PAGE}`;
    const resp = await sbGet(url);
    if (!Array.isArray(resp.body)) throw new Error('DB null-content fetch failed');
    resp.body.forEach(r => { if (r.url_full) urls.add(r.url_full); });
    if (resp.body.length < PAGE) break;
    offset += PAGE;
  }
  return urls;
}

// ── Map WP item → Supabase row ────────────────────────────────────────────────

function mapItem(item, nullContentUrls, wpPostType) {
  const m = item.meta || {};
  const url = cleanUrl(item.link);
  if (!url) return null;

  // Featured image from embedded
  let featuredImageUrl = null;
  try {
    const media = (item._embedded || {})['wp:featuredmedia'];
    if (media && media[0] && !media[0].code && media[0].source_url) {
      featuredImageUrl = media[0].source_url;
    }
  } catch (_) {}

  // Rendered title — decoded HTML entities
  const title = decodeTitle(item.title?.rendered);

  // Excerpt — strip tags
  const excerpt = stripExcerpt(item.excerpt?.rendered);

  // Base row — these fields always update
  const base = {
    url_full:       url,
    wp_post_type:   wpPostType,   // required NOT NULL
    record_id:      String(item.id),
    title,
    status:         ns(item.status),
    date_published: item.date    ? new Date(item.date).toISOString()     : null,
    date_modified:  item.modified ? new Date(item.modified).toISOString() : null,
    excerpt,
    featured_image_url: featuredImageUrl,
    keyword:     ns(m.keyword),
    question_1:  ns(m.question_1),  answer_1: ns(m.answer_1),
    question_2:  ns(m.question_2),  answer_2: ns(m.answer_2),
    question_3:  ns(m.question_3),  answer_3: ns(m.answer_3),
    question_4:  ns(m.question_4),  answer_4: ns(m.answer_4),
    question_5:  ns(m.question_5),  answer_5: ns(m.answer_5),
    question_6:  ns(m.question_6),  answer_6: ns(m.answer_6),
    hyperlink_1: ns(m['hyperlink-1']),
    hyperlink_2: ns(m['hyperlink-2']),
    hyperlink_3: ns(m['hyperlink-3']),
    hyperlink_4: ns(m['hyperlink-4']),
    hyperlink_5: ns(m['hyperlink-5']),
  };

  // Content — ONLY fill where DB currently has null
  if (nullContentUrls.has(url)) {
    const html = ns(item.content?.rendered);
    base.content_html = html;
    base.content_text = stripHtml(html);
  }

  return base;
}

// ── Normalise batch (all rows must have identical key sets) ───────────────────

function normalise(rows) {
  const keys = new Set();
  rows.forEach(r => Object.keys(r).forEach(k => keys.add(k)));
  const ks = [...keys];
  return rows.map(r => {
    const out = {};
    ks.forEach(k => { out[k] = r[k] !== undefined ? r[k] : null; });
    return out;
  });
}

// ── Upsert in batches ─────────────────────────────────────────────────────────

async function upsertAll(rows, label) {
  if (rows.length === 0) { console.log(`  [${label}] nothing to upsert`); return; }
  const total   = rows.length;
  const batches = Math.ceil(total / BATCH_SIZE);
  let done = 0, errors = 0;
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch   = normalise(rows.slice(i, i + BATCH_SIZE));
    const batchNo = Math.floor(i / BATCH_SIZE) + 1;
    process.stdout.write(`  [${label}] Batch ${batchNo}/${batches}... `);
    try {
      const resp = await sbPost(`${SUPABASE}/rest/v1/content?on_conflict=url_full`, batch);
      if (resp.status < 200 || resp.status >= 300) throw new Error(`${resp.status}: ${JSON.stringify(resp.body).substring(0, 300)}`);
      done += batch.length;
      console.log('OK');
    } catch (e) {
      errors++;
      console.log(`ERROR: ${e.message.substring(0, 200)}`);
    }
    await new Promise(r => setTimeout(r, 150));
  }
  console.log(`  [${label}] Done: ${done} rows, ${errors} errors\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== COMPREHENSIVE WP → DB MERGE ===\n');

  // Verify auth
  const wc = new URL(`${WP_BASE}/wp-json/wp/v2/pages?per_page=1`);
  const testResp = await wpGet(wc.href);
  if (!Array.isArray(testResp.body)) {
    console.error(`WP API test failed (${testResp.status}): ${JSON.stringify(testResp.body).substring(0, 200)}`);
    process.exit(1);
  }
  console.log(`WP API OK — can reach passionates.com REST API\n`);

  // Pre-fetch URLs that have NULL content_html in DB
  console.log('Pre-fetching DB rows with NULL content_html...');
  const nullContentUrls = await fetchNullContentUrls();
  console.log(`  ${nullContentUrls.size} URLs need content_html filled\n`);

  // Fetch WP pages
  console.log('Fetching WP pages (with auth)...');
  const wpPages = await fetchWPAll('pages');
  console.log(`  ${wpPages.length} pages fetched`);

  // Fetch WP posts
  console.log('Fetching WP posts (with auth)...');
  const wpPosts = await fetchWPAll('posts');
  console.log(`  ${wpPosts.length} posts fetched\n`);

  const allItems = [...wpPages, ...wpPosts];
  const mapped   = [
    ...wpPages.map(item => mapItem(item, nullContentUrls, 'page')),
    ...wpPosts.map(item => mapItem(item, nullContentUrls, 'post')),
  ].filter(Boolean);

  // Split: rows with content vs without (to avoid overwriting existing content_html with null)
  const withContent    = mapped.filter(r => 'content_html' in r);
  const withoutContent = mapped.map(r => {
    const copy = { ...r };
    delete copy.content_html;
    delete copy.content_text;
    return copy;
  });

  const withImg  = mapped.filter(r => r.featured_image_url).length;
  const withKw   = mapped.filter(r => r.keyword).length;
  const withQ1   = mapped.filter(r => r.question_1).length;
  console.log(`Mapped ${mapped.length} rows total:`);
  console.log(`  ${withContent.length} will have content_html filled (were NULL)`);
  console.log(`  ${withImg} have featured_image_url`);
  console.log(`  ${withKw} have keyword`);
  console.log(`  ${withQ1} have question_1`);
  console.log();

  // Pass 1: upsert all rows WITHOUT content fields (safe — won't null-out existing content)
  console.log('--- Pass 1: base fields (title, record_id, dates, meta, image) ---');
  await upsertAll(withoutContent, 'all');

  // Pass 2: upsert only the rows that need content filled
  if (withContent.length > 0) {
    console.log('--- Pass 2: fill missing content_html ---');
    await upsertAll(withContent, 'content');
  }

  // Summary
  console.log('=== COMPLETE ===');
  console.log(`Updated ${mapped.length} rows (${wpPages.length} pages + ${wpPosts.length} posts)`);
  console.log(`\n⚠️  RANK_MATH FIELDS NOT YET IMPORTED`);
  console.log(`   The ClaudeAI role needs "edit_posts" + "edit_pages" capabilities.`);
  console.log(`   WP Admin → Users → Roles → edit the custom role → enable those two.`);
  console.log(`   Then re-run: node C:\\tools\\import-wp-auth.js`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
