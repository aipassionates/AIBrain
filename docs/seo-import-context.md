# SEO Tracking System — Context for Next Session
*passionates.com | Created 2026-06-08*

---

## Goal

Build an SEO tracking and content management system for **passionates.com** (creative/AI agency) to recover organic traffic lost since December 2024.

The system consists of:
1. **Supabase DB** — single source of truth for all pages/posts metadata
2. **n8n weekly workflow** — AI analysis using DB data to generate content improvement recommendations
3. **Google Search Console** — performance data (clicks, impressions, position) fed into `performance` table

---

## What Was Completed (Previous Sessions)

### Phase 1: Supabase DB setup ✅
Three tables created in project `cjwwkmaiqsbgygqtjxel`:
- `content` — all pages/posts metadata (PRIMARY table)
- `performance` — weekly GSC search performance data
- `changelog` — tracks AI recommendations and content changes

### Phase 2: Data import ✅

**Import 1 — Google Sheets** (`C:\tools\import-to-supabase.js`)
- Source: 3 Google Sheets (All Page Manager, Passionate all posts, All Competitor comparison manager)
- Inserted: 316 posts + 81 comparison pages = ~397 rows
- Captured: RankMath fields, keywords, FAQs, hyperlinks, categories, author, read_time, etc.
- Limitation: Pages sheet (16.4MB) was truncated to 267 of 2,361 rows — only 226 pages with URLs were usable

**Import 2 — WordPress REST API** (`C:\tools\import-wp-pages.js`)
- Source: `https://passionates.com/wp-json/wp/v2/pages` and `.../posts`
- Fetched: 2,307 pages + 610 posts = 2,917 rows
- Captured: title, slug, canonical URL (with parent path), status, dates, excerpt, custom meta fields (keyword, question_1-6, answer_1-6, hyperlink-1 through hyperlink-5)
- Key: Used `link` field for `url_full` — gives correct parent-path URLs (e.g. `/ai-agency/ai-chatbot-services`)
- Mode: `ignore-duplicates` — did NOT overwrite existing sheet data for rows already imported

**Deduplication** (manual SQL, this session)
- Found 137 pages imported twice: slug-only URL (sheet) + correct parent-path URL (WP API)
- Merged RankMath fields from slug-only rows → parent-path rows
- Deleted the 137 wrong-URL rows

---

## Current DB State (2026-06-08)

| Type | Total | keyword | rm_focus_kw | rm_title | rm_desc | FAQs | excerpt |
|------|-------|---------|-------------|----------|---------|------|---------|
| page | 2,312 | 2,263   | 146         | 142      | 144     | 2,300| 2,299   |
| post |   656 | 0       | 346         | 197      | 179     |  602 |   335   |
| **Total** | **2,968** | | | | | | |

**URL structure for pages:**
- 2,259 at `/parent/slug` depth (from WP API — correct canonical URLs)
- 52 at `/slug` depth (true top-level WP pages: `/ai-agency`, `/branding-agency`, `/shop`, etc.)
- 1 at deeper path (edge case)

**No duplicate url_full values exist.** Verified clean.

---

## What's Still Missing — The Main Gap

### RankMath fields for ~2,166 pages
Only 146/2,312 pages have `rank_math_title`, `rank_math_description`, `rank_math_focus_keyword`.

These fields come from WordPress RankMath plugin custom meta. They are:
- **NOT exposed** by the public WP REST API (require authentication)
- **IN** the All Page Manager Google Sheet — but the sheet is 16.4MB and truncates at ~267 rows when read via Drive API

The fields missing for most pages:
- `rank_math_title` — custom page title for search results
- `rank_math_description` — meta description
- `rank_math_focus_keyword` — target keyword (different from the WP meta `keyword` field)

### Posts: `keyword` field is 0
Posts don't expose `keyword` via WP meta (that field is only populated for pages). Posts use `rank_math_focus_keyword` instead (346 posts have it, from sheets import).

### `featured_image_url` for pages: 0
WP REST API's `/pages` endpoint doesn't include featured image URL in the basic `_fields` query — requires `_embed` or a separate media endpoint lookup per page (expensive). Not critical for SEO analysis.

---

## The Next Phase — WP API Authenticated Import

### What to do
Use **WordPress Application Password** to authenticate WP REST API calls and retrieve RankMath custom meta fields for all 2,300+ pages.

### Why auth is needed
Unauthenticated WP REST API: `meta` object returns only fields explicitly registered for public REST exposure. RankMath fields (`rank_math_focus_keyword`, `rank_math_title`, `rank_math_description`, etc.) are NOT registered for public access — they return empty.

With Application Password auth: The `meta` object returns ALL custom meta fields.

### How to create a WP Application Password
1. Log into WordPress admin at `https://passionates.com/wp-admin`
2. Users → Profile → Application Passwords section
3. Enter name "Claude API" → click Add New Application Password
4. Copy the password (shown once) — format: `xxxx xxxx xxxx xxxx xxxx xxxx`
5. Store in env var: `[Environment]::SetEnvironmentVariable("WP_APP_PASS", "...", "User")`

### API authentication
```
Basic auth: base64("username:app_password")
Header: Authorization: Basic <base64>
```

Example:
```js
const auth = Buffer.from(`admin:xxxx xxxx xxxx xxxx xxxx xxxx`).toString('base64');
// In request headers: 'Authorization': 'Basic ' + auth
```

### Expected meta fields available with auth
From the pages spreadsheet column headers, these are the custom fields to capture:
- `rank_math_title`
- `rank_math_description`  
- `rank_math_focus_keyword`
- `rank_math_pillar_content` (value: "on" or "off")
- `rank_math_seo_score` (integer)
- `rank_math_primary_category`
- `rank_math_rich_snippet`
- `keyword` (already captured for pages from public API, but verify)
- `question_1` through `question_6` (already captured, verify)
- `answer_1` through `answer_6` (already captured, verify)
- `hyperlink-1` through `hyperlink-5` (already captured, verify)

For posts, also try: `rank_math_focus_keyword`, `rank_math_seo_score`, `rank_math_primary_category`

---

## Import Script Patterns

### Existing scripts to reference
- `C:\tools\import-wp-pages.js` — fetch all WP pages+posts, upsert to Supabase
- `C:\tools\import-to-supabase.js` — parse Google Sheets exports, upsert to Supabase

### Key patterns used

**Fetching all WP pages (paginated):**
```js
const WP_BASE = 'https://passionates.com/wp-json/wp/v2';
const PER_PAGE = 100;
// GET /pages?per_page=100&page=N&_fields=id,slug,link,meta
// Headers: x-wp-total, x-wp-totalpages in response
```

**DO NOT use `status=any`** without auth — returns error object instead of array.

**Supabase upsert pattern:**
```js
// Endpoint: POST /rest/v1/content?on_conflict=url_full
// Header: Prefer: resolution=merge-duplicates,return=minimal
// (use merge-duplicates for authenticated import to UPDATE existing rows with RankMath data)
```

**CRITICAL: Use `merge-duplicates` for the RankMath update, NOT `ignore-duplicates`**
- `ignore-duplicates` = skip rows that already exist (used in Phase 2 to protect sheet data)
- `merge-duplicates` = update existing rows with new data (needed for Phase 3 to add RankMath to WP rows)

But be careful: `merge-duplicates` will overwrite ALL fields. Use a PATCH approach or only include the specific meta fields in the update payload (not title, status, etc.) to avoid overwriting WP-correct values with potentially stale sheet values.

**Better approach for Phase 3:** Use SQL UPDATE per record (matching on url_full or record_id) rather than PostgREST bulk upsert, or only include the specific RankMath columns in the upsert payload.

**Normalize key sets before batch insert:**
```js
// All rows in a batch must have IDENTICAL key sets for PostgREST
function normalise(rows) {
  const allKeys = new Set();
  rows.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
  const keys = [...allKeys];
  return rows.map(r => {
    const out = {};
    keys.forEach(k => { out[k] = r[k] !== undefined ? r[k] : null; });
    return out;
  });
}
```

---

## Supabase Connection Details

```
Project ID:  cjwwkmaiqsbgygqtjxel
REST URL:    https://cjwwkmaiqsbgygqtjxel.supabase.co/rest/v1/
Anon key:    <SUPABASE_ANON_KEY_PASSIONATES - stored in Bitwarden>
RLS:         Disabled on all 3 tables (anon key has full read/write access)
```

**Headers for REST API calls:**
```
apikey: <anon key>
Authorization: Bearer <anon key>
Content-Type: application/json
Prefer: resolution=merge-duplicates,return=minimal  (for upserts)
```

---

## Content Table Schema (key columns)

```sql
CREATE TABLE content (
  id                        BIGSERIAL PRIMARY KEY,
  wp_post_type              TEXT,           -- 'page' or 'post'
  record_id                 TEXT,           -- WP post ID (as string)
  title                     TEXT,
  url_slug                  TEXT,
  url_full                  TEXT UNIQUE,    -- canonical URL, conflict key
  status                    TEXT,           -- 'publish', 'draft', 'private', 'Published'
  date_published            TIMESTAMPTZ,
  date_modified             TIMESTAMPTZ,
  excerpt                   TEXT,
  keyword                   TEXT,           -- WP custom meta: primary keyword
  rank_math_title           TEXT,           -- RankMath SEO title
  rank_math_description     TEXT,           -- RankMath meta description
  rank_math_focus_keyword   TEXT,           -- RankMath target keyword
  rank_math_seo_score       INTEGER,
  rank_math_pillar_content  BOOLEAN,
  rank_math_primary_category TEXT,
  rank_math_rich_snippet    TEXT,
  page_category             TEXT,           -- sheet field: "Grow, Service" etc.
  page_parent               TEXT,           -- WP parent ID or parent name
  author                    TEXT,
  featured_image_url        TEXT,
  categories                TEXT[],         -- array of category names
  tags                      TEXT[],
  read_time                 INTEGER,
  youtube_url               TEXT,
  hyperlink_1 .. hyperlink_5 TEXT,          -- internal link HTML from WP meta
  question_1 .. question_7   TEXT,          -- FAQ questions
  answer_1 .. answer_7       TEXT,          -- FAQ answers
  created_at                TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Google Sheets Reference

| Sheet | Drive ID | Rows | Notes |
|-------|----------|------|-------|
| All Page Manager | `1GCeE7FncTgG-YjEpXhWkF5p1D-5DXizGDJa-FvU0loA` | ~2,361 | 16.4MB — too large to export via Drive API |
| Passionate all posts | `1c16_2HdDZ8w3-ehurtWoK0sG4fAlfAO6_4NtAAP10lo` | 316 (main tab) | Exported OK as CSV |
| All Competitor comparison manager | `1yJBQmiCrbW2KhV1bbMz7mGCyXP6GxflkZK7WX1WVEyw` | 81 with URLs | 6.2MB — too large to export |

**Pages sheet columns (for reference):**
`record_id, Title, Modified Date, Page category, Rank Math Title, Page Parent, Status, URL Slug, Content, Rank Math Pillar Content, Keyword, Featured Image, Rank Math Focus Keyword, Rank Math Description, Question 1..7, Answer 1..7, Hyperlink 1..5`

**To get pages sheet data without the Content column:** Ask user to export a version of the sheet without the Content column — it will be small enough to download as CSV.

---

## Recommended Phase 3 Script Approach

```js
// Phase 3: Fetch RankMath meta via authenticated WP REST API
// then PATCH only the rank_math_* columns for each page

const WP_AUTH = Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString('base64');

// 1. Fetch pages with auth (gets full meta object)
const url = `${WP_BASE}/pages?per_page=100&page=${p}&_fields=id,link,meta`;
const res = await get(url, { 'Authorization': 'Basic ' + WP_AUTH });

// 2. Map only the RankMath fields
function mapRankMath(item) {
  const m = item.meta || {};
  return {
    url_full: cleanUrl(item.link),  // used as the lookup key
    rank_math_title:         ns(m['rank_math_title']),
    rank_math_description:   ns(m['rank_math_description']),
    rank_math_focus_keyword: ns(m['rank_math_focus_keyword']),
    rank_math_seo_score:     toInt(m['rank_math_seo_score']),
    rank_math_pillar_content: m['rank_math_pillar_content'] === 'on',
    rank_math_primary_category: ns(m['rank_math_primary_category']),
  };
}

// 3. Upsert to Supabase with merge-duplicates (updates existing rows)
// POST /rest/v1/content?on_conflict=url_full
// Prefer: resolution=merge-duplicates,return=minimal
// Only include rank_math_* fields + url_full in each row object
```

---

## Performance Table (empty — next import task)

The `performance` table is empty. GSC data (4,899 pages) was fetched in a previous session and saved to:
```
C:\Users\user\.claude\projects\C--Users-user\41ed0edb-b51d-4ea6-aabd-1bc47bb09e63\tool-results\mcp-1cbfcbd4-e334-4f14-9e91-7e1b7378af77-gsc_query_performance-1780966348421.txt
```

Schema:
```sql
CREATE TABLE performance (
  id            BIGSERIAL PRIMARY KEY,
  content_id    BIGINT REFERENCES content(id),
  url_full      TEXT,
  date_week     DATE,
  clicks        INTEGER,
  impressions   INTEGER,
  ctr           NUMERIC,
  position      NUMERIC,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

---

## n8n Workflow (Phase 4 — not yet built)

**Target workflow:** Weekly AI analysis using Supabase data → content improvement recommendations

**Architecture:**
- Trigger: Weekly schedule
- Read from Supabase: Pages with low click-through (from performance table) vs high impressions
- AI analysis (Claude via n8n): Compare keyword vs rank_math fields, identify optimization opportunities
- Output: Insert into `changelog` table + email report

**n8n connection:**
- URL: `https://api.passionate.agency/api/v1` (do NOT use localhost — SSRF blocks it)
- Auth: `X-N8N-API-KEY: $env:N8N_API_KEY`

---

## Key Files

| File | Purpose |
|------|---------|
| `C:\tools\import-to-supabase.js` | Phase 1 import from Google Sheets |
| `C:\tools\import-wp-pages.js` | Phase 2 import from WP REST API (public) |
| `C:\tools\audit-sheets.js` | Audit script for comparing sheets vs DB |
| `C:\Users\user\seo-import-context.md` | This file |

---

## Verified Working

- ✅ All column mappings correct (every field name matched exactly between sheets and DB)
- ✅ Posts: 316 rows fully imported, no duplicates, correct field mapping
- ✅ Comparisons: 81 rows fully imported, correct field mapping
- ✅ WP API: 2,307 pages + 610 posts with correct canonical URLs
- ✅ No duplicate url_full values in DB
- ✅ RankMath data from 226 sheet pages merged onto correct canonical URL rows (137 duplicates removed)
- ✅ Supabase anon key bypasses RLS (RLS disabled on all tables)
