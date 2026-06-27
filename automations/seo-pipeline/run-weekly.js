/**
 * run-weekly.js — deterministic weekly SEO pipeline (NO AI, NO permission prompts).
 *
 * Runs end-to-end via PM2 cron (Mondays). Order:
 *   1. fetch-weekly.mjs   → pull GSC (5 windows) + GA4 (full + 7d) to C:\tools\data\
 *   2. enrich-gsc / -wow / -ga4   → fill the `content` table
 *   3. append-performance         → add this week's `performance` snapshot
 *   4. verify-export-vs-db        → gate: export must equal DB
 * Writes a structured result to C:\tools\data\last-run.json (read by the Claude supervisor),
 * appends one line to weekly-runs.log, emails a report if Gmail creds are configured, and
 * exits non-zero on any failure so PM2 records it.
 *
 *   Run: node C:/tools/run-weekly.js              (real today)
 *        node C:/tools/run-weekly.js 2026-06-22   (override "today" for a dry run)
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TOOLS = 'C:\\tools';
const DATA = path.join(TOOLS, 'data');
const RESULT = path.join(DATA, 'last-run.json');
const LOG = path.join(DATA, 'weekly-runs.log');
const TODAY_OVERRIDE = (process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2])) ? process.argv[2] : null;

function runStep(name, args, cwd) {
  // Redirect child stdout/stderr to a FILE (not a pipe). Synchronous execFileSync does not
  // drain a child's stdout pipe while it blocks, so a long-running child (3000+ sequential
  // PATCHes) stalls and never exits. Writing to a file fd avoids the pipe entirely.
  const started = new Date().toISOString();
  const logPath = path.join(DATA, `_step-${name.replace(/[^a-z0-9]/gi, '_')}.log`);
  const fd = fs.openSync(logPath, 'w');
  let ok = true, errMsg = '';
  try {
    execFileSync('node', args, { cwd: cwd || TOOLS, stdio: ['ignore', fd, fd], timeout: 25 * 60 * 1000 });
  } catch (e) { ok = false; errMsg = e.message; }
  finally { try { fs.closeSync(fd); } catch (_) {} }
  let output = '';
  try { output = fs.readFileSync(logPath, 'utf8'); } catch (_) {}
  if (!ok) output += `\n[runStep ${name} error: ${errMsg}]`;
  return { name, ok, started, output };
}
function pick(re, s, d) { const m = (s || '').match(re); return m ? m[1] : d; }

async function notify(subject, body) {
  // Email is OPTIONAL and never fails the run. Sends via Gmail SMTP if GMAIL_USER +
  // GMAIL_APP_PASSWORD env vars are set and nodemailer is installed; otherwise skips.
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.SEO_REPORT_TO || 'gor@passionates.com';
  if (!user || !pass) { console.log('[notify] email disabled (set GMAIL_USER + GMAIL_APP_PASSWORD to enable)'); return 'disabled'; }
  let nodemailer; try { nodemailer = require('nodemailer'); } catch (_) { console.log('[notify] nodemailer not installed'); return 'no-nodemailer'; }
  try {
    const t = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await t.sendMail({ from: user, to, subject, text: body });
    console.log(`[notify] emailed ${to}`); return 'sent';
  } catch (e) { console.log(`[notify] email failed: ${e.message}`); return 'error'; }
}

function finish(steps, snapshot, verifyOk) {
  const allOk = steps.every(s => s.ok) && verifyOk;
  const status = allOk ? 'SUCCESS' : 'FAILED';
  const g = steps.find(s => s.name === 'enrich-gsc.js')?.output || '';
  const a = steps.find(s => s.name === 'enrich-ga4.js')?.output || '';
  const p = steps.find(s => s.name === 'append-performance')?.output || '';
  const v = steps.find(s => s.name === 'verify')?.output || '';
  const summary = {
    status, snapshot, finished_at: new Date().toISOString(),
    counts: {
      gsc_updated: pick(/Updated\s*:\s*(\d+)/, g),
      ga4_updated: pick(/Updated\s*:\s*(\d+)/, a),
      performance_upserted: pick(/upserted\s+(\d+)/, p),
      verify_all_ok: !/XX|MISMATCH/.test(v) && /match/.test(v),
    },
    steps: steps.map(s => ({ name: s.name, ok: s.ok, tail: s.output.split('\n').slice(-6).join('\n') })),
  };
  fs.writeFileSync(RESULT, JSON.stringify(summary, null, 2));
  fs.appendFileSync(LOG, `${summary.finished_at} ${status} snapshot=${snapshot} gsc=${summary.counts.gsc_updated} ga4=${summary.counts.ga4_updated} perf=${summary.counts.performance_upserted} verifyOK=${summary.counts.verify_all_ok}\n`);
  const failed = steps.filter(s => !s.ok).map(s => s.name);
  const body = [
    `SEO weekly refresh: ${status}`,
    `Snapshot: ${snapshot}`,
    `content: GSC ${summary.counts.gsc_updated} updated, GA4 ${summary.counts.ga4_updated} updated`,
    `performance: ${summary.counts.performance_upserted} rows upserted`,
    `verify export==DB: ${summary.counts.verify_all_ok ? 'PASS' : 'FAIL'}`,
    failed.length ? `Failed steps: ${failed.join(', ')}` : 'All steps OK',
    '', 'Full result: C:\\tools\\data\\last-run.json',
  ].join('\n');
  notify(`${allOk ? '✅' : '❌'} SEO weekly refresh ${status} — ${snapshot}`, body)
    .then(() => process.exit(allOk ? 0 : 1));
}

(function main() {
  console.log(`=== RUN-WEEKLY ${new Date().toISOString()} ${TODAY_OVERRIDE ? '(today=' + TODAY_OVERRIDE + ')' : ''} ===`);
  const steps = [];

  const fetchArgs = ['google-analytics-mcp/fetch-weekly.mjs']; if (TODAY_OVERRIDE) fetchArgs.push(TODAY_OVERRIDE);
  const fetch = runStep('fetch', fetchArgs, TOOLS); steps.push(fetch); console.log(fetch.output);
  if (!fetch.ok) { return finish(steps, TODAY_OVERRIDE || 'unknown', false); }  // abort: don't enrich on stale data

  let snapshot = TODAY_OVERRIDE;
  try { snapshot = JSON.parse(fs.readFileSync(path.join(DATA, 'fetch-meta.json'), 'utf8')).snapshot; } catch (_) {}

  for (const f of ['enrich-gsc.js', 'enrich-gsc-wow.js', 'enrich-ga4.js']) {
    const s = runStep(f, [f], TOOLS); steps.push(s); console.log(s.output.split('\n').slice(-4).join('\n'));
  }
  const ap = runStep('append-performance', ['append-performance.js', snapshot, 'gsc-curr7.json', 'ga4-curr7.json'], TOOLS);
  steps.push(ap); console.log(ap.output.split('\n').slice(-4).join('\n'));

  const v = runStep('verify', ['verify-export-vs-db.js'], TOOLS); steps.push(v); console.log(v.output);
  const verifyOk = v.ok && !/XX|MISMATCH/.test(v.output) && /match/.test(v.output);

  finish(steps, snapshot, verifyOk);
})();
