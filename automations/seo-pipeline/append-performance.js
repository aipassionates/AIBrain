/**
 * Append a weekly snapshot to the `performance` time-series table.
 *
 * Inserts/updates one row per URL for a given snapshot_date, with per-week GSC + GA4
 * metrics and deltas vs the previous snapshot. Upserts on (url_full, snapshot_date),
 * so re-running for the same week is idempotent.
 *
 * Only URLs that exist in `content` are written (so rows join cleanly; redirect-source
 * URLs are skipped). URL matching is LOWERCASE — content.url_full is lowercase while
 * GSC/GA4 report mixed-case silo paths.
 *
 * Usage:
 *   node C:/tools/append-performance.js <snapshot_date> [gscFile] [ga4File]
 *   node C:/tools/append-performance.js 2026-06-15 gsc-week-2026-06-15.json ga4-week-2026-06-15.json
 *   node C:/tools/append-performance.js 2026-06-29            # defaults to gsc-curr7.json / ga4-curr7.json
 */
'use strict';
const fs    = require('fs');
const https = require('https');
const path  = require('path');

const SUPABASE = 'https://cjwwkmaiqsbgygqtjxel.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const DATA = 'C:\\tools\\data';

const SNAPSHOT = process.argv[2];
const GSC_FILE = process.argv[3] || 'gsc-curr7.json';
const GA4_FILE = process.argv[4] || 'ga4-curr7.json';
if (!SNAPSHOT || !/^\d{4}-\d{2}-\d{2}$/.test(SNAPSHOT)) {
  console.error('Usage: node append-performance.js <YYYY-MM-DD> [gscFile] [ga4File]');
  process.exit(1);
}

function normUrl(u) {
  if (!u) return '';
  let p;
  try { p = new URL(u).pathname; } catch (_) { p = u; }
  p = p.replace(/\/$/, '').toLowerCase();
  return p === '' ? 'https://passionates.com' : 'https://passionates.com' + p;
}
function parseCtr(s) { return parseFloat(String(s || '0').replace('%', '')) / 100; }
function loadRows(f) { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')).rows || []; }

// ── Supabase helpers ─────────────────────────────────────────────────────────
function sbGet(pathQ) {
  return new Promise((res, rej) => {
    const u = new URL(SUPABASE + pathQ);
    https.get({ hostname: u.hostname, path: u.pathname + u.search,
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } },
      r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); })
      .on('error', rej);
  });
}
function sbUpsert(rows) {
  return new Promise((res, rej) => {
    const body = JSON.stringify(rows);
    const u = new URL(SUPABASE + '/rest/v1/performance?on_conflict=url_full,snapshot_date');
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        Prefer: 'resolution=merge-duplicates,return=minimal' } },
      r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d })); });
    req.on('error', rej); req.write(body); req.end();
  });
}
async function contentMap() {
  const map = new Map(); let off = 0;
  while (true) {
    // order=url_full → stable pagination (offset paging without ORDER BY skips rows
    // under concurrent writes, since Postgres MVCC reorders updated row versions).
    const rows = await sbGet(`/rest/v1/content?select=id,url_full,gsc_index_status&order=url_full&limit=1000&offset=${off}`);
    if (!rows.length) break;
    for (const r of rows) map.set(r.url_full, { id: r.id, idx: r.gsc_index_status });
    if (rows.length < 1000) break; off += 1000;
  }
  return map;
}
async function prevSnapshot() {
  // most recent snapshot strictly before SNAPSHOT
  const dates = await sbGet(`/rest/v1/performance?select=snapshot_date&snapshot_date=lt.${SNAPSHOT}&order=snapshot_date.desc&limit=1`);
  if (!dates.length) return { date: null, map: new Map() };
  const prevDate = dates[0].snapshot_date;
  const map = new Map(); let off = 0;
  while (true) {
    const rows = await sbGet(`/rest/v1/performance?select=url_full,gsc_clicks,gsc_impressions,gsc_position,ga_users&snapshot_date=eq.${prevDate}&order=url_full&limit=1000&offset=${off}`);
    if (!rows.length) break;
    for (const r of rows) map.set(r.url_full, r);
    if (rows.length < 1000) break; off += 1000;
  }
  return { date: prevDate, map };
}

// ── Build per-URL weekly metrics ─────────────────────────────────────────────
function buildWeek(gscRows, ga4Rows) {
  const m = new Map();
  const get = u => m.get(u) || { gsc_clicks: null, gsc_impressions: null, gsc_position: null, gsc_ctr: null, ga_users: null, ga_eng: null, ga_sessions: null };
  // GSC: keep canonical/highest (rows are sorted clicks desc; keep first per URL)
  for (const r of gscRows) {
    const u = normUrl(r.page); if (!u) continue;
    const cur = get(u);
    if (cur.gsc_clicks === null) {     // first (highest-traffic) wins
      cur.gsc_clicks = r.clicks; cur.gsc_impressions = r.impressions;
      cur.gsc_position = Math.round(r.position * 10) / 10; cur.gsc_ctr = parseCtr(r.ctr);
    }
    m.set(u, cur);
  }
  // GA4: SUM variants per URL
  for (const r of ga4Rows) {
    const u = normUrl(r.pagePath); if (!u) continue;
    const users = parseInt(r.activeUsers, 10); if (isNaN(users)) continue;
    const eng = parseInt(r.userEngagementDuration, 10) || 0;
    const sess = parseInt(r.sessions, 10) || 0;
    const cur = get(u);
    cur.ga_users = (cur.ga_users || 0) + users;
    cur.ga_eng = (cur.ga_eng || 0) + eng;
    cur.ga_sessions = (cur.ga_sessions || 0) + sess;
    m.set(u, cur);
  }
  return m;
}

async function main() {
  console.log(`=== APPEND PERFORMANCE SNAPSHOT ${SNAPSHOT} ===`);
  console.log(`GSC: ${GSC_FILE} | GA4: ${GA4_FILE}\n`);

  const week = buildWeek(loadRows(GSC_FILE), loadRows(GA4_FILE));
  console.log(`Week URLs with data: ${week.size}`);

  const content = await contentMap();
  const prev = await prevSnapshot();
  console.log(`Content rows: ${content.size} | Previous snapshot: ${prev.date || '(none)'} (${prev.map.size} rows)\n`);

  const out = [];
  let skippedNoContent = 0;
  for (const [url, w] of week) {
    const c = content.get(url);
    if (!c) { skippedNoContent++; continue; }          // not an analyzed page (e.g. redirect source)
    const p = prev.map.get(url);
    const avgEng = w.ga_sessions > 0 ? Math.round((w.ga_eng / w.ga_sessions) * 100) / 100 : (w.ga_users ? 0 : null);
    out.push({
      content_id: c.id,
      url_full: url,
      snapshot_date: SNAPSHOT,
      gsc_clicks: w.gsc_clicks, gsc_impressions: w.gsc_impressions,
      gsc_position: w.gsc_position, gsc_ctr: w.gsc_ctr,
      gsc_index_status: c.idx,
      ga_users: w.ga_users, ga_avg_engagement_sec: avgEng,
      clicks_delta:      p && w.gsc_clicks != null && p.gsc_clicks != null ? w.gsc_clicks - p.gsc_clicks : null,
      impressions_delta: p && w.gsc_impressions != null && p.gsc_impressions != null ? w.gsc_impressions - p.gsc_impressions : null,
      position_delta:    p && w.gsc_position != null && p.gsc_position != null ? Math.round((w.gsc_position - p.gsc_position) * 10) / 10 : null,
      users_delta:       p && w.ga_users != null && p.ga_users != null ? w.ga_users - p.ga_users : null,
    });
  }
  console.log(`Rows to upsert: ${out.length}  (skipped ${skippedNoContent} URLs not in content)`);

  let ok = 0, err = 0;
  for (let i = 0; i < out.length; i += 200) {
    const batch = out.slice(i, i + 200);
    const r = await sbUpsert(batch);
    if (r.status >= 200 && r.status < 300) ok += batch.length;
    else { err += batch.length; if (err <= 400) console.log(`  ERR ${r.status}: ${r.body.slice(0, 200)}`); }
  }
  console.log(`\n=== DONE ${SNAPSHOT}: upserted ${ok}, errors ${err} ===`);
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
