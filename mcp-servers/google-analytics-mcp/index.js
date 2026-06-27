/**
 * google-analytics-mcp — MCP server for Google Analytics 4 + Search Console
 *
 * Tools:
 *   ga4_run_report         — Flexible GA4 report (any dimensions + metrics)
 *   gsc_query_performance  — Search Console performance data
 *   gsc_list_sites         — List accessible Search Console sites
 *
 * Config via env vars (set in PM2 ecosystem file):
 *   GA4_PROPERTY_ID   — Default GA4 property ID (digits only, e.g. "123456789")
 *   GSC_SITE_URL      — Default GSC site URL (e.g. "https://passionateagency.com/")
 *   CREDENTIALS_PATH  — Path to OAuth credentials.json (default: same dir as this file)
 *   TOKEN_PATH        — Path to saved token.json (default: same dir as this file)
 *
 * Auth: run `node auth.js` once to complete browser OAuth and save token.json.
 * Tokens refresh automatically — no re-auth needed.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { google } from "googleapis";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH ?? join(__dirname, "credentials.json");
const TOKEN_PATH = process.env.TOKEN_PATH ?? join(__dirname, "token.json");
const DEFAULT_PROPERTY = process.env.GA4_PROPERTY_ID ?? "";
const DEFAULT_SITE = process.env.GSC_SITE_URL ?? "";

function getAuth() {
  if (!existsSync(CREDENTIALS_PATH)) {
    throw new Error(`credentials.json not found at ${CREDENTIALS_PATH}. Run node auth.js first.`);
  }
  if (!existsSync(TOKEN_PATH)) {
    throw new Error(`token.json not found at ${TOKEN_PATH}. Run node auth.js to authorize.`);
  }

  const creds = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8"));
  const { client_id, client_secret } = creds.installed;
  const oauth2Client = new google.auth.OAuth2(
    client_id, client_secret, "http://localhost:3000"
  );

  const tokens = JSON.parse(readFileSync(TOKEN_PATH, "utf8"));
  oauth2Client.setCredentials(tokens);

  oauth2Client.on("tokens", (newTokens) => {
    const existing = existsSync(TOKEN_PATH)
      ? JSON.parse(readFileSync(TOKEN_PATH, "utf8"))
      : {};
    writeFileSync(TOKEN_PATH, JSON.stringify({ ...existing, ...newTokens }, null, 2));
  });

  return oauth2Client;
}

const server = new McpServer({
  name: "google-analytics-mcp",
  version: "1.0.0",
});

// ── Tool 1: GA4 Run Report ────────────────────────────────────────────────────

server.tool(
  "ga4_run_report",
  [
    "Run a Google Analytics 4 report. Returns rows for the specified dimensions and metrics.",
    "",
    "Common dimensions: pagePath, pageTitle, date, sessionDefaultChannelGrouping,",
    "  deviceCategory, country, landingPage, sessionSource, sessionMedium",
    "",
    "Common metrics: sessions, activeUsers, newUsers, screenPageViews, bounceRate,",
    "  averageSessionDuration, engagementRate, eventCount, conversions",
    "",
    `Default property: ${DEFAULT_PROPERTY || "(set GA4_PROPERTY_ID env var or pass property_id)"}`,
  ].join("\n"),
  {
    property_id: z.string().optional().describe(
      `GA4 property ID (digits only). Defaults to GA4_PROPERTY_ID env var (${DEFAULT_PROPERTY || "not set"}).`
    ),
    start_date: z.string().describe(
      'Start date: "YYYY-MM-DD" or relative like "30daysAgo", "7daysAgo", "yesterday" (capital A required)'
    ),
    end_date: z.string().describe(
      'End date: "YYYY-MM-DD", "today", or "yesterday"'
    ),
    dimensions: z.array(z.string()).describe(
      'GA4 dimensions to group by, e.g. ["pagePath", "date"]'
    ),
    metrics: z.array(z.string()).describe(
      'GA4 metrics to return, e.g. ["sessions", "users", "screenPageViews"]'
    ),
    limit: z.number().optional().default(100).describe(
      "Max rows to return (default 100)"
    ),
    order_by_metric: z.string().optional().describe(
      "Sort results by this metric descending (e.g. \"sessions\")"
    ),
    dimension_filter: z.object({
      field_name: z.string(),
      match_type: z.enum(["EXACT", "BEGINS_WITH", "ENDS_WITH", "CONTAINS", "PARTIAL_REGEXP", "FULL_REGEXP"]),
      value: z.string(),
    }).optional().describe(
      'Filter rows by a dimension value, e.g. {"field_name":"pagePath","match_type":"BEGINS_WITH","value":"/blog"}'
    ),
  },
  async ({ property_id, start_date, end_date, dimensions, metrics, limit, order_by_metric, dimension_filter }) => {
    const propId = property_id || DEFAULT_PROPERTY;
    if (!propId) {
      throw new Error("property_id is required — pass it in the tool call or set GA4_PROPERTY_ID in the PM2 config.");
    }

    const auth = getAuth();
    const analyticsdata = google.analyticsdata({ version: "v1beta", auth });

    const requestBody = {
      dateRanges: [{ startDate: start_date, endDate: end_date }],
      dimensions: dimensions.map(d => ({ name: d })),
      metrics: metrics.map(m => ({ name: m })),
      limit,
    };

    if (order_by_metric) {
      requestBody.orderBys = [{ metric: { metricName: order_by_metric }, desc: true }];
    }

    if (dimension_filter) {
      requestBody.dimensionFilter = {
        filter: {
          fieldName: dimension_filter.field_name,
          stringFilter: {
            matchType: dimension_filter.match_type,
            value: dimension_filter.value,
          },
        },
      };
    }

    const response = await analyticsdata.properties.runReport({
      property: `properties/${propId}`,
      requestBody,
    });

    const data = response.data;
    const dimHeaders = (data.dimensionHeaders || []).map(h => h.name);
    const metHeaders = (data.metricHeaders || []).map(h => h.name);

    const rows = (data.rows || []).map(row => {
      const obj = {};
      (row.dimensionValues || []).forEach((v, i) => { obj[dimHeaders[i]] = v.value; });
      (row.metricValues || []).forEach((v, i) => { obj[metHeaders[i]] = v.value; });
      return obj;
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          property: `properties/${propId}`,
          date_range: { start_date, end_date },
          total_row_count: data.rowCount,
          rows_returned: rows.length,
          rows,
        }, null, 2),
      }],
    };
  }
);

// ── Tool 2: GSC Query Performance ─────────────────────────────────────────────

server.tool(
  "gsc_query_performance",
  [
    "Query Google Search Console performance data (clicks, impressions, CTR, position).",
    "",
    "Dimensions: query, page, country, device, date, searchAppearance",
    "Search types: web (default), image, video, news, discover, googleNews",
    "",
    `Default site: ${DEFAULT_SITE || "(set GSC_SITE_URL env var or pass site_url)"}`,
  ].join("\n"),
  {
    site_url: z.string().optional().describe(
      `GSC site URL (e.g. "https://passionateagency.com/" or "sc-domain:passionateagency.com"). Defaults to GSC_SITE_URL env var.`
    ),
    start_date: z.string().describe("Start date YYYY-MM-DD"),
    end_date: z.string().describe("End date YYYY-MM-DD"),
    dimensions: z.array(
      z.enum(["query", "page", "country", "device", "date", "searchAppearance"])
    ).describe(
      'Dimensions to group by, e.g. ["query"] or ["page", "query"]'
    ),
    row_limit: z.number().optional().default(100).describe("Max rows (default 100, max 25000)"),
    start_row: z.number().optional().default(0).describe("Pagination offset"),
    search_type: z.enum(["web", "image", "video", "news", "discover", "googleNews"]).optional().default("web"),
    page_filter: z.string().optional().describe(
      'Filter to a specific page URL (exact match), e.g. "https://passionateagency.com/services/"'
    ),
    query_filter: z.string().optional().describe(
      'Filter to queries containing this string, e.g. "marketing"'
    ),
  },
  async ({ site_url, start_date, end_date, dimensions, row_limit, start_row, search_type, page_filter, query_filter }) => {
    const siteUrl = site_url || DEFAULT_SITE;
    if (!siteUrl) {
      throw new Error("site_url is required — pass it in the tool call or set GSC_SITE_URL in the PM2 config.");
    }

    const auth = getAuth();
    const searchconsole = google.searchconsole({ version: "v1", auth });

    const requestBody = {
      startDate: start_date,
      endDate: end_date,
      dimensions,
      rowLimit: row_limit,
      startRow: start_row,
      type: search_type,
    };

    const filters = [];
    if (page_filter) {
      filters.push({ dimension: "page", operator: "equals", expression: page_filter });
    }
    if (query_filter) {
      filters.push({ dimension: "query", operator: "contains", expression: query_filter });
    }
    if (filters.length > 0) {
      requestBody.dimensionFilterGroups = [{ filters }];
    }

    const response = await searchconsole.searchanalytics.query({
      siteUrl,
      requestBody,
    });

    const rows = (response.data.rows || []).map(row => {
      const obj = {};
      (row.keys || []).forEach((key, i) => { obj[dimensions[i]] = key; });
      obj.clicks = row.clicks;
      obj.impressions = row.impressions;
      obj.ctr = `${(row.ctr * 100).toFixed(2)}%`;
      obj.position = Math.round(row.position * 10) / 10;
      return obj;
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          site: siteUrl,
          date_range: { start_date, end_date },
          search_type,
          rows_returned: rows.length,
          rows,
        }, null, 2),
      }],
    };
  }
);

// ── Tool 3: GSC List Sites ────────────────────────────────────────────────────

server.tool(
  "gsc_list_sites",
  "List all Search Console sites (properties) accessible to the authorized account.",
  {},
  async () => {
    const auth = getAuth();
    const searchconsole = google.searchconsole({ version: "v1", auth });
    const response = await searchconsole.sites.list();

    return {
      content: [{
        type: "text",
        text: JSON.stringify(response.data.siteEntry || [], null, 2),
      }],
    };
  }
);

// ── Tool 4: GSC URL Inspection ────────────────────────────────────────────────

server.tool(
  "gsc_inspect_url",
  [
    "Inspect a URL in Google Search Console.",
    "Returns: indexing status, last crawl date, crawl errors, canonical URL,",
    "mobile usability, rich result eligibility, and whether Google can access the page.",
    "Use this to diagnose why a page isn't ranking or to confirm a page is indexed.",
    `Default site: ${DEFAULT_SITE || "(set GSC_SITE_URL env var or pass site_url)"}`,
  ].join("\n"),
  {
    inspection_url: z.string().describe(
      'Full URL to inspect, e.g. "https://passionates.com/services/"'
    ),
    site_url: z.string().optional().describe(
      "GSC site URL the page belongs to. Defaults to GSC_SITE_URL env var."
    ),
  },
  async ({ inspection_url, site_url }) => {
    const siteUrl = site_url || DEFAULT_SITE;
    if (!siteUrl) {
      throw new Error("site_url is required — pass it or set GSC_SITE_URL in the PM2 config.");
    }

    const auth = getAuth();
    const searchconsole = google.searchconsole({ version: "v1", auth });

    const response = await searchconsole.urlInspection.index.inspect({
      requestBody: {
        inspectionUrl: inspection_url,
        siteUrl,
      },
    });

    const r = response.data.inspectionResult;

    const result = {
      url: inspection_url,
      verdict: r.indexStatusResult?.verdict,
      coverage_state: r.indexStatusResult?.coverageState,
      indexing_state: r.indexStatusResult?.indexingState,
      last_crawl_time: r.indexStatusResult?.lastCrawlTime,
      google_canonical: r.indexStatusResult?.googleCanonical,
      user_canonical: r.indexStatusResult?.userDeclaredCanonical,
      crawled_as: r.indexStatusResult?.crawledAs,
      page_fetch_state: r.indexStatusResult?.pageFetchState,
      robots_txt_state: r.indexStatusResult?.robotsTxtState,
      sitemap: r.indexStatusResult?.sitemap || [],
      mobile_usability: r.mobileUsabilityResult?.verdict,
      mobile_issues: (r.mobileUsabilityResult?.issues || []).map(i => i.issueType),
      rich_results: (r.richResultsResult?.detectedItems || []).map(item => ({
        type: item.richResultType,
        items: (item.items || []).map(i => ({
          name: i.name,
          issues: (i.issues || []).map(iss => iss.issueMessage),
        })),
      })),
    };

    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

// ── Tool 5: GSC List Sitemaps ─────────────────────────────────────────────────

server.tool(
  "gsc_list_sitemaps",
  [
    "List all sitemaps submitted to Google Search Console for a site.",
    "Shows each sitemap's URL, submission date, last download date,",
    "number of URLs submitted, number indexed, and any errors/warnings.",
    `Default site: ${DEFAULT_SITE || "(set GSC_SITE_URL env var or pass site_url)"}`,
  ].join("\n"),
  {
    site_url: z.string().optional().describe(
      "GSC site URL. Defaults to GSC_SITE_URL env var."
    ),
    sitemap_index: z.string().optional().describe(
      "Filter to a specific sitemap index URL (optional)"
    ),
  },
  async ({ site_url, sitemap_index }) => {
    const siteUrl = site_url || DEFAULT_SITE;
    if (!siteUrl) {
      throw new Error("site_url is required — pass it or set GSC_SITE_URL in the PM2 config.");
    }

    const auth = getAuth();
    const searchconsole = google.searchconsole({ version: "v1", auth });

    const response = await searchconsole.sitemaps.list({
      siteUrl,
      sitemapIndex: sitemap_index,
    });

    const sitemaps = (response.data.sitemap || []).map(s => ({
      path: s.path,
      last_submitted: s.lastSubmitted,
      last_downloaded: s.lastDownloaded,
      is_pending: s.isPending,
      is_sitemaps_index: s.isSitemapsIndex,
      type: s.type,
      warnings: s.warnings,
      errors: s.errors,
      contents: (s.contents || []).map(c => ({
        type: c.type,
        submitted: c.submitted,
        indexed: c.indexed,
      })),
    }));

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          site: siteUrl,
          sitemaps_count: sitemaps.length,
          sitemaps,
        }, null, 2),
      }],
    };
  }
);

// ── Tool 6: GA4 Realtime Report ───────────────────────────────────────────────

server.tool(
  "ga4_run_realtime_report",
  [
    "Run a Google Analytics 4 real-time report covering the last 30 minutes of activity.",
    "Use this to monitor live traffic after publishing content, during campaigns, or to check active users.",
    "This is completely separate from ga4_run_report — no date range, data is always live.",
    "",
    "Realtime dimensions: country, city, deviceCategory, operatingSystem, browser,",
    "  pageTitle, unifiedPageScreen, eventName, audienceName, streamId",
    "",
    "Realtime metrics: activeUsers, eventCount, eventCountPerUser,",
    "  screenPageViews, screenPageViewsPerSession, conversions",
    "",
    `Default property: ${DEFAULT_PROPERTY || "(set GA4_PROPERTY_ID env var or pass property_id)"}`,
  ].join("\n"),
  {
    property_id: z.string().optional().describe(
      `GA4 property ID (digits only). Defaults to GA4_PROPERTY_ID env var (${DEFAULT_PROPERTY || "not set"}).`
    ),
    dimensions: z.array(z.string()).describe(
      'Realtime dimensions, e.g. ["country"] or ["pageTitle", "deviceCategory"]'
    ),
    metrics: z.array(z.string()).describe(
      'Realtime metrics, e.g. ["activeUsers"] or ["activeUsers", "screenPageViews"]'
    ),
    limit: z.number().optional().default(20).describe("Max rows (default 20)"),
  },
  async ({ property_id, dimensions, metrics, limit }) => {
    const propId = property_id || DEFAULT_PROPERTY;
    if (!propId) throw new Error("property_id is required or set GA4_PROPERTY_ID env var.");

    const auth = getAuth();
    const analyticsdata = google.analyticsdata({ version: "v1beta", auth });

    const response = await analyticsdata.properties.runRealtimeReport({
      property: `properties/${propId}`,
      requestBody: {
        dimensions: dimensions.map(d => ({ name: d })),
        metrics: metrics.map(m => ({ name: m })),
        limit,
      },
    });

    const data = response.data;
    const dimHeaders = (data.dimensionHeaders || []).map(h => h.name);
    const metHeaders = (data.metricHeaders || []).map(h => h.name);

    const rows = (data.rows || []).map(row => {
      const obj = {};
      (row.dimensionValues || []).forEach((v, i) => { obj[dimHeaders[i]] = v.value; });
      (row.metricValues || []).forEach((v, i) => { obj[metHeaders[i]] = v.value; });
      return obj;
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          property: `properties/${propId}`,
          window: "last 30 minutes",
          rows_returned: rows.length,
          rows,
        }, null, 2),
      }],
    };
  }
);

// ── Tool 8: GA4 Get Metadata ──────────────────────────────────────────────────

server.tool(
  "ga4_get_metadata",
  [
    "List all valid dimensions and metrics available for a GA4 property.",
    "Use this when you need to know the exact API name for a dimension or metric,",
    "or to discover what custom dimensions/metrics exist for a specific property.",
    "Filter by type ('dimensions', 'metrics', or 'all') and optionally search by name.",
    `Default property: ${DEFAULT_PROPERTY || "(set GA4_PROPERTY_ID env var or pass property_id)"}`,
  ].join("\n"),
  {
    property_id: z.string().optional().describe(
      `GA4 property ID. Defaults to GA4_PROPERTY_ID env var (${DEFAULT_PROPERTY || "not set"}).`
    ),
    type: z.enum(["dimensions", "metrics", "all"]).optional().default("all").describe(
      "Return only dimensions, only metrics, or all (default)"
    ),
    search: z.string().optional().describe(
      'Filter results to entries whose name or description contains this string (case-insensitive), e.g. "page" or "session"'
    ),
  },
  async ({ property_id, type, search }) => {
    const propId = property_id || DEFAULT_PROPERTY;
    if (!propId) throw new Error("property_id is required or set GA4_PROPERTY_ID env var.");

    const auth = getAuth();
    const analyticsdata = google.analyticsdata({ version: "v1beta", auth });

    const response = await analyticsdata.properties.getMetadata({
      name: `properties/${propId}/metadata`,
    });

    const data = response.data;
    const searchLower = search?.toLowerCase();

    const filterFn = item =>
      !searchLower ||
      item.apiName?.toLowerCase().includes(searchLower) ||
      item.uiName?.toLowerCase().includes(searchLower) ||
      item.description?.toLowerCase().includes(searchLower);

    const result = {};

    if (type === "dimensions" || type === "all") {
      result.dimensions = (data.dimensions || [])
        .filter(filterFn)
        .map(d => ({ api_name: d.apiName, ui_name: d.uiName, description: d.description, category: d.category }));
    }

    if (type === "metrics" || type === "all") {
      result.metrics = (data.metrics || [])
        .filter(filterFn)
        .map(m => ({ api_name: m.apiName, ui_name: m.uiName, description: m.description, category: m.category, type: m.type }));
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          property: `properties/${propId}`,
          dimensions_count: result.dimensions?.length,
          metrics_count: result.metrics?.length,
          ...result,
        }, null, 2),
      }],
    };
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
