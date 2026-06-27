# Knowledgebase Ingestion — Learnings & Playbook

> Living document. Append learnings as we ingest new content types/sources.
> Supabase project: **Knowledgebase** (`pbfwvccswhdogdqsfwtg`), table `public.sources`.
> Last updated: 2026-06-25.

## Purpose & scope
`gor@passionateagency.com` receives emails that may be useful to the **passionates.com** and **crolytics.ai** audiences. Anything containing genuinely useful **marketing, UX/CRO, design, automation, AI, or development** advice should be scraped into the Knowledgebase as **one row per unique knowledge item**, with full content. Future: optional RAG once the corpus is large (only if it improves accuracy).

## Inclusion bar
INCLUDE if it teaches a transferable tactic, framework, insight, or data point in the topics above.
EXCLUDE pure promo with no transferable content. BUT note: most "course/webinar" newsletters *teach the tactic while promoting* — those are keepers. Dead webinar registrations still keep their captured thesis. When unsure → flag for the user, don't silently delete.

## Content model (one row per knowledge item; content split across columns)
| Column | Holds |
|---|---|
| `title`, `source_url`, `publisher`, `source_type` | identity/metadata |
| `summary` | AI-extracted takeaways |
| `email_body` | the source email content (from Drive ClaudeEmailQueue JSON) |
| `full_transcript` | **full primary content of the asset**: recording transcript \| full blog article \| full ebook/PDF/report text |
| `video_id`, `local_video_path`, `local_transcript_path` | recording assets |
| `processing_status` | `pending` \| `complete` \| `unavailable` (or error note) |

Never split the same knowledge into two rows (one for the email, one for the video) — it's ONE row with multiple columns filled.

`source_type` CHECK currently: `youtube | cxl | zoom | podcast | other`. New publishers (Webflow, VWO, ABTasty, Microsoft, TwelveLabs…) currently fall under `other` — may need broadening or a dedicated `platform` field. **(open question)**

## Content Type Catalog & Extraction Flows
Strategy: prove one flow per type, then mass-populate. Status as of 2026-06-25.

| # | Content type | Source examples | Extraction flow | Status |
|---|---|---|---|---|
| 1 | YouTube video | Neil Patel videos | `yt-dlp` auto-subs (json3/vtt) → text → `full_transcript`; set `video_id` | ✅ PROVEN |
| 2 | Gated LMS recording | CXL `app.cxl.com` | logged-in Chrome → transcript panel scrape (`project_cxl_transcript_scraping`) | ✅ PROVEN |
| 3 | Text-based PDF / ebook | Webflow ebook | `pdftotext -layout` → text → `full_transcript` | ✅ PROVEN |
| 4 | Design-heavy PDF / report | The AEO Divide | pdftotext garbles it; report page is gated → **visual `Read` of the PDF** | ⏳ prototype |
| 5 | HTML blog / article | cxl.com/blog | **SCRIPTABLE & BATCHED:** `curl.exe -A <browserUA>` (passes Cloudflare; WebFetch 403s and PowerShell `Invoke-WebRequest` gets the CF JS-challenge) → regex-extract `<article>` → strip tags → `[System.Net.WebUtility]::HtmlDecode` → `full_transcript`. One PowerShell loop did 8 CXL articles. neilpatel.com fails curl with SSL err 35 → use browser `get_page_text` for NP. COM `HTMLFile` parsing returned empty — don't rely on it. | ✅ PROVEN |
| 6 | Email newsletter body | Drive ClaudeEmailQueue JSON | read JSON → clean `.body` → `email_body`; record Gmail msg-id in `source_email_id`. Match by **exact subject+date** (fuzzy `fullText` search is unreliable — matches stray words). Fill-only, never overwrite. | ✅ PROVEN |
| 7 | Vendor webinar recording | VWO, MS EventBuilder, Webflow | TBD — inspect for embedded player + transcript/caption track | ⏳ prototype |
| 8 | Zoom `/video/` recording | provided Zoom links | TBD — try `yt-dlp`, else browser capture | ⏳ prototype |
| 9 | Podcast / audio | ABTasty "Taste Test"? | TBD — find transcript page, else audio→STT | ⏳ prototype |
| 10 | Listing / aggregator page | VWO/Webflow/MS Ads hubs | enumerate items → route each to the right flow above | ⏳ |

Notes: WebFetch returns a *small-model answer* (not raw markdown) and 403s on bot-protected sites (CXL) — unreliable for verbatim article capture; prefer browser `get_page_text`. Many DB `source_url`s point to the course/landing page, not a real article — only rows with a true `/blog/` or article URL can be article-fetched.

## Tools & methods
- Supabase writes: PowerShell REST (PATCH/POST) or `execute_sql`.
- **CRITICAL:** read transcript/text files with `[System.IO.File]::ReadAllText($f)` — NOT `Get-Content -Raw | ConvertTo-Json` (PS note-properties corrupt the value as `{"value":…,"PSProvider":…}`).
- `yt-dlp` at `C:\tools\yt-dlp.exe`.
- Email bodies: Drive ClaudeEmailQueue folder (`parentId 1q1ySIReqDAAWiboIJa-xA5aicaBVFwC9`), `email_*.json` = `{threadId,subject,sender,date,body}`.
- Web articles: WebFetch (HTML→markdown). PDFs: WebFetch CANNOT parse PDF binary — download + extract text instead.
- PDF text: `pdftotext -layout` (Git Bash `/mingw64/bin`, v4.00). Works for text-based PDFs (e.g. Webflow ebook → clean 51k chars). FAILS on design-heavy PDFs with custom/outlined font encoding — output comes out reversed/scrambled (e.g. "The AEO Divide"). Fallback for those: WebFetch the HTML report page, or visual `Read` of the PDF. (No Python on this machine.)
- New PDFs/ebooks: extract → save text to `D:\media\documents\` → load into `full_transcript` via `[IO.File]::ReadAllText`.

## Dedup rules
- One row per knowledge item; merge same-item rows keeping richest content, union unique facts.
- Do NOT dedup by URL alone — the same CXL workshop appears under many URLs.
- Boilerplate intros (CXL's standard webinar intro) are NOT proof of same content — verify by matching mid-content.

## Gotchas log
- PowerShell `ConvertTo-Json` on a `Get-Content -Raw` string wraps it as an object (`{"value":…,"PSProvider":…,"ReadCount":1}`) → corrupts `full_transcript`. Use `[IO.File]::ReadAllText`.
- Chrome `javascript_tool` blocks returning signed URLs / base64 / cookies (classifier). Return plain text; for big transcripts use an in-page blob download.
- `javascript_tool` async IIFE returns a Promise → result shows `{}`; store on a `window` var and read back.
- CDP screenshots intermittently time out — just retry.
- PostgREST upsert `ON CONFLICT (source_url)` 400s on the partial unique index — use a plain POST.

## Verification gap
The DB does not store the source email's Gmail message-id, so an exact 1:1 "all emails ingested" audit isn't possible today. **Recommend adding `source_email_id`** to make completeness verifiable going forward.

## Source itemization & extraction status (2026-06-25, one-of-each test)
| Source | Useful items | Types | Audience fit | Extraction |
|---|---|---|---|---|
| Webflow | ~11 (9 webinars + ebook + AEO report) | ebook/report PDF, webinars | High (AEO/SEO/agency) | ebook ✅ pdftotext; AEO report ❌ font-encoded PDF |
| VWO | ~10 webinars | webinar recordings + decks | High (CRO/UX) | ⚠️ recordings gated behind registration/thank-you |
| AB Tasty | 4 (Taste Test eps) | ~15-min video series | High (CRO/personalization) | ⚠️ Cloudflare challenge + per-episode pages |
| TwelveLabs | 1 issue (#122 ⇒ ~122 archived) | webinar series / newsletter | Low (technical multimodal AI) | ✅ WebFetch |
| Microsoft Advertising | many (blog/webcasts/case studies/Learning Lab) | resource hub | Moderate (paid search/ads) | ⚠️ main site itemizable; EventBuilder event JS-gated |

Key extraction findings: `curl.exe` passes Cloudflare for CXL articles, but vendor **recordings** (VWO/Webflow/MS/ABTasty) are gated behind registration / login / CF / JS — NOT bulk-extractable without authenticating per vendor (like we do for CXL) or finding a YouTube mirror + Whisper. Design-heavy PDFs (AEO Divide) need OCR (`pdftoppm`/Tesseract — not installed). Update flow rows #4 (design-PDF → ❌ needs OCR), #7 (vendor webinar → ❌ gated), #9 (podcast → gated) accordingly.

## Open questions / TODO
- Scope of listing/aggregator pages (vwo/webinars, webflow/resources, abtasty, microsoft ads, twelvelabs weekly): scrape every item, or specific ones?
- `source_type` for non-CXL/NP publishers.
- Backfill `email_body` (Drive) + `full_transcript` (full articles) for existing rows.
