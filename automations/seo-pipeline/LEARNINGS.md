# Passionates Content DB — Build Learnings

> Written 2026-06-09. Covers the full build of the Supabase `content` and `performance` tables
> for passionates.com. Reference this when replicating for other WordPress sites.

---

## Scripts (C:\tools\)

| Script | Purpose | Run again? |
|---|---|---|
| `import-wp-merge.js` | Sync all WP posts/pages to content table (title, status, dates, excerpt, content_html, content_text, featured_image via public API) | Yes — weekly |
| `import-rankmath-api.js` | Pull rank_math_* fields via custom WP plugin endpoint (token auth) | Yes — after RankMath changes |
| `add-taxonomy-pages.js` | Insert category/tag/industry/services taxonomy archive pages as content rows | One-time, re-run after new taxonomies added |
| `fix-primary-category.js` | Resolve rank_math_primary_category from term IDs → names (public API) | One-time, re-run if new categories added |
| `import-performance.js` | Bulk-import 12 weeks GSC + GA4 data into performance table from local files | One-time historical import |
| `enrich-wp-auth.js` | Populate author, categories, tags, featured_image, rank_math_robots, rank_math_canonical_url via WP App Password auth | Needs WP_USER_PASSIONATES + WP_APP_PASS_PASSIONATES env vars |

---

## Data Sources & Connection Methods

### WordPress REST API (public, no auth)
- Posts: `GET /wp-json/wp/v2/posts?per_page=100&page=N`
- Pages: `GET /wp-json/wp/v2/pages?per_page=100&page=N`
- CPTs: `GET /wp-json/wp/v2/types` → discover, then `GET /wp-json/wp/v2/{rest_base}`
- Taxonomies (public): `/wp-json/wp/v2/categories`, `/tags`, `/industry`, `/services`, etc.
- `_embed=true` adds author name and featured image URL inline — avoids extra requests

### WordPress REST API (App Password auth)
- Add `Authorization: Basic base64(user:app_pass)` header
- Add `?context=edit` to get all `meta` fields (rank_math_*, ACF, etc.)
- Requires Editor or Administrator role
- Set up: WP Admin → Users → Edit User → Application Passwords → Add New
- Env vars: `WP_USER_PASSIONATES`, `WP_APP_PASS_PASSIONATES`
- Gotcha: The WP user role matters. Contributor role cannot read meta with context=edit.

### Custom WP Plugin Endpoint (`passionates/v1/seo-meta`)
- Token via URL param: `?token=CLAUDE_SEO_TOKEN`
- Returns rank_math fields for all posts/pages in bulk (faster than per-post REST)
- Missing fields: `rank_math_robots`, `rank_math_canonical_url` — must be added to the plugin
- Located on WP server in `wp-content/plugins/` — needs PHP edit to extend

### Google Search Console (MCP tool: `gsc_query_performance`)
- Results auto-saved to tool-results files (do NOT lose these — they're your historical record)
- File format: `{ site, date_range, rows: [{ page, clicks, impressions, ctr, position }] }`
- **CTR is a string like "2.10%"** — parse as `parseFloat(str.replace('%','')) / 100`
- Bulk query returns one row per URL per date range. One API call per week.
- Index status (PASS/NEUTRAL/FAIL) requires per-URL `gsc_inspect_url` — too expensive at scale

### Google Analytics 4 (MCP tool: `ga4_run_report`)
- Returns path (not full URL): `/category/ai-news/` not `https://passionates.com/category/ai-news`
- Prefix with `https://passionates.com` + strip trailing slash to normalize
- Average engagement time returns as decimal seconds (e.g. 24.73) — store as `numeric`, not `integer`
- GA4 coverage ≠ GSC coverage. GA4 misses pages where snippet didn't fire. Always outer-join.

---

## Database Schema

### `content` table — key columns
| Column | Source | Notes |
|---|---|---|
| `url_full` | WP link field | Primary unique key. Always normalize: lowercase, strip trailing slash |
| `url_slug` | WP slug | Just the slug, no path prefix |
| `wp_post_type` | WP | post, page, projects, careers, product, category, tag, industry, services, document |
| `content_source` | Set by import | wordpress, taxonomy, document, system, pipeline |
| `is_editable` | Set by flag | false for taxonomy, document, system, pipeline |
| `include_in_analysis` | Set by flag | false for pipeline, system, noindex, draft, low-value pages |
| `noindex` | rank_math_robots | Set true when robots contains 'noindex' |
| `rank_math_robots` | WP meta | Needs enrich-wp-auth.js to populate |
| `rank_math_canonical_url` | WP meta | Needs enrich-wp-auth.js to populate |
| `rank_math_primary_category` | WP meta | Stored as numeric term ID — resolve via fix-primary-category.js |
| `categories` | WP meta | Array of category names — needs enrich-wp-auth.js |
| `tags` | WP meta | Array of tag names — needs enrich-wp-auth.js |
| `author` | WP user | Needs enrich-wp-auth.js |
| `word_count` | Calculated | `array_length(regexp_split_to_array(trim(content_text), '\s+'), 1)` |
| `read_time` | Calculated | `ceil(word_count / 200.0)` minutes |
| `content_text` | WP content | Strip HTML from `content.rendered` |

### `performance` table — weekly snapshots
| Column | Source | Notes |
|---|---|---|
| `url_full` + `snapshot_date` | — | Unique constraint (upsert key) |
| `snapshot_date` | GSC date range | Sunday = end-of-week date |
| `gsc_clicks`, `gsc_impressions` | GSC | Integer |
| `gsc_position` | GSC | Numeric (decimal avg position) |
| `gsc_ctr` | GSC | Numeric 0–1 (strip `%`, divide by 100) |
| `ga_users` | GA4 | Integer |
| `ga_avg_engagement_sec` | GA4 | Numeric (decimal seconds — NOT integer) |
| `*_delta` | Calculated | Week N minus week N-1 for same URL |

---

## URL Normalization — the Most Important Rule

**Every URL join fails without consistent normalization. Do this in one function, use it everywhere:**

```js
function norm(url) { return url.replace(/\/$/, '').toLowerCase(); }
```

- Strip trailing slash
- Lowercase everything
- Handle `https://www.` vs `https://` (for other sites)
- GSC returns full URLs. GA4 returns paths only — prefix with base URL before joining.
- WordPress `link` field includes trailing slash. Strip it.

---

## Pipeline Pages (planned/future pages from Google Sheets)

- 7,564 rows in DB with `status = null` and `content_source = 'pipeline'`
- These are planned pages from a keyword research spreadsheet, NOT live WP pages
- Malformed ones (22 rows with `&` in URL, `/` mid-slug, trailing `.`) were deleted
- `include_in_analysis = false` for all pipeline rows
- **Do NOT treat pipeline rows as live pages** — they have no WP record_id, no GSC data, no content

---

## Taxonomy Archive Pages

- WP categories, tags, industry, services, etc. ARE real pages (Google indexes them)
- They appear in GSC and GA4 data but are NOT returned by the posts/pages REST API
- Must be fetched separately from `/wp-json/wp/v2/categories`, `/tags`, etc.
- Set `is_editable = false` — they're auto-generated by WP, not editable in the editor
- Set `include_in_analysis = true` if they have content (count > 0)
- Their performance data joins correctly once they're in the content table

---

## Common Gotchas

1. **`ga_avg_engagement_sec` must be `numeric`, not `integer`** — GA4 returns decimal seconds
2. **GSC CTR is a string `"2.10%"`** — always parse: `parseFloat(str.replace('%','')) / 100`
3. **PostgREST "All object keys must match"** — every row in a batch must have identical keys. Use a normalize function or split into type-specific batches.
4. **`context=edit` returns empty `meta` for anonymous requests** — auth is required for all RankMath fields
5. **WordPress categories on posts need separate API lookup** — the posts endpoint returns `categories: [132, 859]` (IDs), not names. Build a term ID → name map first.
6. **Featured images and Elementor** — many WP sites use Elementor and DON'T set a WP featured image. The `_embedded.wp:featuredmedia` is null. Check if there's a custom meta field for the hero image instead.
7. **Rate limits** — GSC: 2,000 queries/day. WP REST API: no hard limit but add 100ms delays. Supabase PostgREST: no hard limit.
8. **`rank_math_primary_category` stores a WP term ID as a string** (e.g. `"132"`), not the category name. Resolve via public WP API.
9. **URL case sensitivity** — WordPress serves `/Web-Design-Agency/` which redirects to `/web-design-agency/`. Always normalize to lowercase. GSC records the canonical (lowercase) URL so joining works.
10. **Pipeline rows with malformed URLs** — `&` in URLs (should be `-and-`), `/` mid-slug, trailing `.` — all came from Google Sheets manual entry. These are not valid URLs and were deleted.

---

## Remaining Manual Steps (needs WP credentials)

Run `enrich-wp-auth.js` after setting env vars:
```powershell
$env:WP_USER_PASSIONATES = "your-wp-username"
$env:WP_APP_PASS_PASSIONATES = "xxxx xxxx xxxx xxxx xxxx xxxx"
node C:\tools\enrich-wp-auth.js
```

This will populate:
- `author` (316 posts currently have it; ~7,860 posts/pages missing)
- `categories` (599 posts have it; ~7,577 missing)
- `tags` (102 posts have it; ~8,074 missing)
- `featured_image_url` (74 posts have it; ~3,019 missing — many use Elementor so may stay null)
- `rank_math_robots` (new column, fully null — needed for noindex flag accuracy)
- `rank_math_canonical_url` (new column, fully null)

After running enrich-wp-auth.js, also run:
```sql
UPDATE content SET noindex = true, include_in_analysis = false
WHERE rank_math_robots LIKE '%noindex%';
```

And extend the `passionates/v1/seo-meta` WP plugin to also return `rank_math_robots` and
`rank_math_canonical_url` — then re-run `import-rankmath-api.js`.

---

## `gsc_index_status` Column

Currently null for all rows. To populate:
- Use `gsc_inspect_url` MCP tool per URL
- Too expensive to run for 10,000+ URLs (API limits, time)
- Recommended: create an n8n weekly workflow that inspects new/recently modified pages only
- Or: run a targeted one-off inspection for the 200 highest-traffic pages

---

## Replicating for Another WordPress Site (Google Cloud)

See the strategic write-up in session history. Key steps:
1. Collect App Password (Settings → Users → Application Passwords)
2. `GET /wp-json` → check `namespaces` to detect SEO plugin
3. `GET /wp-json/wp/v2/types` → discover all CPTs
4. Fetch 20 posts with `context=edit` → enumerate all meta keys to discover custom fields
5. `GET /wp-json/wp/v2/{type}?per_page=100&page=N&context=edit&_embed=true`
6. Taxonomies: fetch separately from `/wp-json/wp/v2/categories`, `/tags`, custom taxonomy endpoints
7. Full-page HTML: GET the live URL, parse with cheerio for schema, OG tags, heading structure
8. GSC + GA4: connect via Google OAuth service account, weekly Cloud Scheduler jobs
9. Normalize all URLs: lowercase + strip trailing slash before any join

---

## What's in the DB Right Now (2026-06-09)

| Table | Rows |
|---|---|
| `content` | ~10,858 |
| — wordpress posts/pages/CPTs | 3,141 |
| — pipeline (planned, not live) | 7,564 |
| — taxonomy (category/tag/industry/services) | ~180 |
| — document/system special files | ~6 |
| `performance` | 9,170 |
| — date range | 2026-03-23 → 2026-06-08 (12 weeks) |
| — URLs with GSC data | ~840 unique URLs |
| — URLs with GA4 data | ~1,145 weekly row-URL combos |
