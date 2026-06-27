# Passionates SEO/Analytics Data Pipeline

> **Authoritative "how it works" doc.** Written 2026-06-24 from verified, tested behavior.
> The Supabase project `cjwwkmaiqsbgygqtjxel` is the single source of truth for passionates.com
> organic search + website performance. This pipeline keeps it accurate and historical.

---

## 1. The two-table model (read this first)

| Table | Granularity | Updated by | Use it for |
|---|---|---|---|
| **`content`** | 1 row per URL (latest state only — overwritten each week) | weekly enrich-*.js | Current state; this-week WoW/MoM columns; SEO metadata; index status |
| **`performance`** | 1 row per URL **per `snapshot_date`** (weekly history, never overwritten) | weekly append-performance.js | True week-over-week trends; per-week deltas; charting a URL over time |
| **`changelog`** | audit log | (app) | record of changes |

**Key mental model:**
- Filter `content` by a URL → its newest numbers.
- Filter `performance` by a URL → every weekly snapshot for it, with `*_delta` columns.
- `content` does **not** keep history (it's a rolling snapshot). `performance` **is** the history.

---

## 2. THE GOLDEN RULE — URL normalization

**Every URL is stored and matched as: lowercase + no trailing slash + full origin.**
`https://passionates.com/web-design-agency/web-design-london`

Why this matters (this caused two real bugs):
- Google **GSC and GA4 report mixed-case silo paths** like `/Web-Design-Agency/...`, but `content.url_full`
  is 100% lowercase. If a script PATCHes a mixed-case URL it matches **0 rows** and PostgREST still
  returns `204` — a **silent no-op**. ~791 pages were silently not updating before this was fixed.
- GA4 returns separate rows for `/` and `""`, and for trailing-slash variants. These must be **summed**,
  or the last write wins (this zeroed the homepage: 22,215 → 1).

Every enrich/append script lowercases in its `normUrl`/`normPath`. Never remove that.

---

## 3. Weekly automation — what runs every Monday 7am

Defined in `C:\Users\user\.claude\scheduled-tasks\weekly-seo-refresh\SKILL.md` (a Claude Code
scheduled task). Order of operations:

### Fetch (Google APIs → fixed files in `C:\tools\data\`)
| File | Window | Source |
|---|---|---|
| `gsc-curr7.json` | last 7 days (ends today) | GSC `gsc_query_performance` |
| `gsc-prev7.json` | prior 7 days | GSC |
| `gsc-curr30.json` / `gsc-prev30.json` | 30-day windows | GSC |
| `gsc-full.json` | 2025-03-01 → today (full history) | GSC |
| `ga4-data.json` | 2025-03-01 → today (full history) | GA4 `ga4_run_report` |
| `ga4-curr7.json` | last 7 days | GA4 |

### Enrich `content` (overwrites metric columns only — never touches metadata/redirects)
| Script | Reads | Writes to `content` |
|---|---|---|
| **`enrich-gsc.js`** | gsc-full, gsc-curr30, gsc-prev30 | `gsc_clicks, gsc_impressions, gsc_ctr, gsc_position`, `gsc_index_status='INDEXED'` (any page with impressions), `gsc_clicks_mom, clicks_trend, gsc_position_mom, position_trend` |
| **`enrich-gsc-wow.js`** | gsc-curr7, gsc-prev7 | `gsc_clicks_wow, gsc_position_wow` |
| **`enrich-ga4.js`** | ga4-data | `ga_users, ga_avg_engagement_sec` (aggregated/summed per URL) |

### Append `performance` (the time-series — adds one new weekly row per URL)
| Script | Reads | Writes |
|---|---|---|
| **`append-performance.js <snapshot_date> gsc-curr7.json ga4-curr7.json`** | weekly GSC + weekly GA4 + prior snapshot | inserts/upserts one `performance` row per URL for `snapshot_date`, with `clicks_delta/impressions_delta/position_delta/users_delta` vs the previous snapshot. Idempotent on `(url_full, snapshot_date)`. Skips URLs not in `content` (redirect sources). |

### Verify (must pass, or the run is not trustworthy)
| Script | Checks |
|---|---|
| **`verify-export-vs-db.js`** | The numbers in the export files exactly equal what's in `content` (GSC full=max, GSC 7d=max, GA4=sum). Every row prints `OK`. |
| Monotonicity SQL | Across `content`: `gsc_clicks_wow ≤ gsc_clicks_mom ≤ gsc_clicks`, CTR∈[0,1], clicks≤impressions. All counts must be 0. |
| `reconcile-coverage.js` | (ad-hoc) every GSC/GA4 export URL maps to a `content` row; flags case-mismatch no-ops and truly-missing URLs. |

`gsc_index_status` for never-clicked pages is set via the GSC URL Inspection API
(`gsc_inspect_url`) — run on demand, not weekly (quota-limited).

---

## 4. Build / one-time scripts (NOT part of the weekly run)

These built the tables originally. Re-run only when the site structure changes.

| Script | Purpose | When |
|---|---|---|
| `import-wp-merge.js` | Sync all WP posts/pages/CPTs → `content` (title, dates, excerpt, content_text, featured image) | After new pages published |
| `import-rankmath-api.js` | Pull RankMath fields via custom plugin endpoint (token auth) | After RankMath changes |
| `enrich-wp-plugin.js` | WP SEO-meta via `passionates/v1/seo-meta` token endpoint → seo_title/description/focus_keyword, OG, faq_items, seo_score, read_time, schema_types, featured_image | After content/SEO edits |
| `enrich-wp-apppassword.js` | Fallback enrichment via WP App Password (author, categories, tags, page_parent) + HTML scrape (h1_text, og:image). **Blocked by iThemes Security Basic-Auth filter** — see limitations | When token endpoint is insufficient |
| `enrich-redirections.js` | Populate `redirect_url` from the WP Redirection plugin export | After redirect changes |
| `add-taxonomy-pages.js` | Insert category/tag/industry/services archive pages as `content` rows | After new taxonomies |
| `fix-primary-category.js` | Resolve `rank_math_primary_category` term IDs → names | After new categories |
| `detect-schema-types.js` | Derive `schema_types` from RankMath schema meta | After schema changes |
| `import-performance.js` | **ONE-TIME** historical backfill of 12 weeks (Mar 23–Jun 8 2026) into `performance`. **Superseded going forward by `append-performance.js`** — do not re-run | historical only |
| `analyze-ga4-dups.js` | Diagnostic: shows GA4 URL collisions (trailing-slash variants) | ad-hoc |

---

## 5. Storage locations (everything has a fixed home)

| What | Where |
|---|---|
| All pipeline scripts | `C:\tools\*.js` |
| Weekly data files (overwritten each run) | `C:\tools\data\` |
| Weekly scheduled task | `C:\Users\user\.claude\scheduled-tasks\weekly-seo-refresh\SKILL.md` |
| This document | `C:\tools\PIPELINE.md` |
| Original build learnings | `C:\tools\LEARNINGS.md` |
| Supabase project | `cjwwkmaiqsbgygqtjxel` (tables: content, performance, changelog) |
| GSC/GA4 access | MCP server `mcp__1cbfcbd4-…` (gsc_query_performance, ga4_run_report, gsc_inspect_url) |

All scripts share the Supabase anon key inline and write via PostgREST (`PATCH` for content,
`POST … on_conflict` upsert for performance).

---

## 6. How to trust the data (verification you can re-run any time)

```powershell
node C:/tools/verify-export-vs-db.js     # export files == content table (expect all OK)
node C:/tools/reconcile-coverage.js      # every export URL has a content row (expect case-mismatch 0)
```
Plus the monotonicity SQL in the weekly task. Green on all three = `content` faithfully mirrors
GSC/GA4 with no silent gaps.

---

## 7. Known limitations (honest)

1. **`content` keeps no history** — it's overwritten weekly. Use `performance` for trends.
2. **Redirect-source URLs aren't counted** — e.g. clicks on the old `/web-design-packages`
   (which 301s to `/web-design-agency/web-design-packages`) are reported by GSC under the old URL
   and are NOT attributed to the canonical page. These short URLs aren't in `content`, so their
   traffic is currently unmeasured. (Future enhancement: a redirect map to fold them in.)
3. **GA4 thresholding / GSC privacy filtering** — very-low-traffic pages may be omitted by Google;
   such pages can legitimately show null metrics.
4. **WP App Password path blocked** — iThemes Security blocks REST Basic Auth, so
   `enrich-wp-apppassword.js` can't pull some meta. The token-plugin path (`enrich-wp-plugin.js`)
   is the working route. To enable: WP Admin → Security → Advanced → Allow REST API Basic Auth.
5. **`pipeline` content_source rows (7,564)** are planned/keyword pages, not live — `include_in_analysis=false`.
