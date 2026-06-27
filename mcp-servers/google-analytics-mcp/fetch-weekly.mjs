/**
 * Standalone weekly GSC + GA4 fetcher (no MCP, no AI, no human).
 *
 * Reuses the same OAuth credentials.json + token.json the MCP server uses (auto-refresh),
 * fetches the weekly windows, and writes the fixed data files in C:\tools\data\ that the
 * enrichment + append scripts read. Run by run-weekly.js (PM2 cron).
 *
 *   Run: node C:/tools/google-analytics-mcp/fetch-weekly.mjs
 *   Optional: pass a YYYY-MM-DD "today" override as argv[2] (else uses real today).
 */
import { google } from "googleapis";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = join(__dirname, "credentials.json");
const TOKEN_PATH = join(__dirname, "token.json");
const DATA_DIR = "C:\\tools\\data";
const GA4_PROPERTY = process.env.GA4_PROPERTY_ID || "321752992";
const GSC_SITE = process.env.GSC_SITE_URL || "https://passionates.com/";
const FULL_START = "2025-03-01";

function getAuth() {
  const creds = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8"));
  const { client_id, client_secret } = creds.installed;
  const o = new google.auth.OAuth2(client_id, client_secret, "http://localhost:3000");
  o.setCredentials(JSON.parse(readFileSync(TOKEN_PATH, "utf8")));
  o.on("tokens", (nt) => {
    const ex = existsSync(TOKEN_PATH) ? JSON.parse(readFileSync(TOKEN_PATH, "utf8")) : {};
    writeFileSync(TOKEN_PATH, JSON.stringify({ ...ex, ...nt }, null, 2));
  });
  return o;
}

function ymd(d) { return d.toISOString().slice(0, 10); }
function daysAgo(base, n) { const d = new Date(base); d.setUTCDate(d.getUTCDate() - n); return ymd(d); }

async function withRetry(fn, label, tries = 3) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i >= tries) throw new Error(`${label} failed after ${tries}: ${e.message}`);
      console.log(`  ${label} retry ${i} (${e.message})`);
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
}

async function gsc(auth, start, end, rowLimit, file) {
  const sc = google.searchconsole({ version: "v1", auth });
  const resp = await withRetry(() => sc.searchanalytics.query({
    siteUrl: GSC_SITE,
    requestBody: { startDate: start, endDate: end, dimensions: ["page"], rowLimit, type: "web" },
  }), `GSC ${file}`);
  const rows = (resp.data.rows || []).map(r => ({
    page: r.keys[0], clicks: r.clicks, impressions: r.impressions,
    ctr: `${(r.ctr * 100).toFixed(2)}%`, position: Math.round(r.position * 10) / 10,
  }));
  writeFileSync(join(DATA_DIR, file), JSON.stringify({ site: GSC_SITE, date_range: { start, end }, rows_returned: rows.length, rows }, null, 2));
  console.log(`  GSC ${file}: ${rows.length} rows (${start}..${end})`);
}

async function ga4(auth, start, end, limit, file) {
  const ad = google.analyticsdata({ version: "v1beta", auth });
  const resp = await withRetry(() => ad.properties.runReport({
    property: `properties/${GA4_PROPERTY}`,
    requestBody: {
      dateRanges: [{ startDate: start, endDate: end }],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "activeUsers" }, { name: "userEngagementDuration" }, { name: "sessions" }],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      limit,
    },
  }), `GA4 ${file}`);
  const dh = (resp.data.dimensionHeaders || []).map(h => h.name);
  const mh = (resp.data.metricHeaders || []).map(h => h.name);
  const rows = (resp.data.rows || []).map(r => {
    const o = {};
    (r.dimensionValues || []).forEach((v, i) => { o[dh[i]] = v.value; });
    (r.metricValues || []).forEach((v, i) => { o[mh[i]] = v.value; });
    return o;
  });
  writeFileSync(join(DATA_DIR, file), JSON.stringify({ property: GA4_PROPERTY, date_range: { start, end }, rows_returned: rows.length, rows }, null, 2));
  console.log(`  GA4 ${file}: ${rows.length} rows (${start}..${end})`);
}

async function main() {
  const today = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2]) ? new Date(process.argv[2] + "T00:00:00Z") : new Date();
  const T = ymd(today);
  console.log(`=== FETCH WEEKLY (today=${T}) ===`);
  const auth = getAuth();

  // GSC — 5 windows
  await gsc(auth, daysAgo(today, 6), T, 5000, "gsc-curr7.json");
  await gsc(auth, daysAgo(today, 13), daysAgo(today, 7), 5000, "gsc-prev7.json");
  await gsc(auth, daysAgo(today, 30), T, 10000, "gsc-curr30.json");
  await gsc(auth, daysAgo(today, 60), daysAgo(today, 31), 10000, "gsc-prev30.json");
  await gsc(auth, FULL_START, T, 25000, "gsc-full.json");

  // GA4 — full history (content) + current 7d (performance snapshot)
  await ga4(auth, FULL_START, T, 10000, "ga4-data.json");
  await ga4(auth, daysAgo(today, 6), T, 10000, "ga4-curr7.json");

  // Stamp the snapshot date for run-weekly.js
  writeFileSync(join(DATA_DIR, "fetch-meta.json"), JSON.stringify({ snapshot: T, fetched_at: new Date().toISOString() }, null, 2));
  console.log(`=== FETCH DONE (snapshot=${T}) ===`);
}
main().catch(e => { console.error("FETCH FATAL:", e.message); process.exit(1); });
