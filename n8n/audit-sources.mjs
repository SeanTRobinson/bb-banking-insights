#!/usr/bin/env node
// Read-only source audit — probes every registry's direct AND fallback
// endpoints (not just whichever one the workflow currently uses) and
// reports HTTP status, content type, parseability, newest in-feed date,
// and in-window item count. Nothing here writes to Supabase or touches
// seen_articles; this is the quarterly "did any of these 100+ endpoints
// quietly change shape" check described in docs/source-audit-guide.md.
//
//   node newsletter/n8n/audit-sources.mjs                # human table
//   node newsletter/n8n/audit-sources.mjs --json          # machine-readable
//   node newsletter/n8n/audit-sources.mjs --only rss      # one registry
//
// Exit code is 1 if any endpoint that is a workflow's ACTIVE path (not a
// dormant direct.url kept only for the audit trail) fails to parse — so
// this can also run in CI/cron and be treated as a real check, not just a
// report to read.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataRoot = join(here, '..', 'data');
const UA = 'BackbaseInsights/1.0 (n8n newsletter ingestion; +https://backbase.com)';

function dataFile(name) {
  return JSON.parse(readFileSync(join(dataRoot, name), 'utf8'));
}

// shared/pool-helpers.js has no module system (see build-workflow.mjs's
// @include comment) — wrap it once here the same way test/harness.mjs does,
// so this script probes feeds with the EXACT parser the workflow runs, not
// a second copy that could quietly drift from it.
function loadPoolHelpers() {
  const src = readFileSync(join(here, 'node-code', 'shared', 'pool-helpers.js'), 'utf8');
  const fn = new Function(`${src}\nreturn { looksLikeFeed, parseFeedEntries };`);
  return fn();
}
const { looksLikeFeed, parseFeedEntries } = loadPoolHelpers();

function googleNewsUrl(query) {
  return 'https://news.google.com/rss/search?q=' + encodeURIComponent(query + ' when:7d') + '&hl=en&gl=US&ceid=US:en';
}

// ---- build the probe list from every registry --------------------------

function rssTargets() {
  const reg = dataFile('rss-sources.json');
  const out = [];
  for (const s of reg.sources) {
    if (s.status === 'quarantined') continue;
    const activePath = s.fetch.method === 'google_news' ? 'google_news_fallback' : 'direct';
    out.push({
      registry: 'rss', source_key: s.source_key, label: s.name, kind: 'direct',
      url: s.fetch.url, active: activePath === 'direct', window_days: s.window_days || 7
    });
    if (s.fetch.method === 'google_news') {
      out.push({
        registry: 'rss', source_key: s.source_key, label: s.name, kind: 'google_news_fallback',
        url: googleNewsUrl(s.fetch.query), active: true, window_days: s.window_days || 7
      });
    }
  }
  return out;
}

function aiTargets() {
  const reg = dataFile('ai-research-sources.json');
  const out = [];
  for (const s of reg.general_ai_rss || []) {
    if (s.status === 'quarantined') continue;
    out.push({ registry: 'ai_research', source_key: s.source_key, label: s.name, kind: 'direct_or_configured_fallback', url: s.url, active: true, window_days: 7 });
  }
  for (const s of reg.targeted_google_news_queries || []) {
    out.push({ registry: 'ai_research', source_key: s.source_key, label: s.name, kind: 'google_news_targeted', url: googleNewsUrl(s.query), active: true, window_days: 7 });
  }
  return out;
}

function customerTargets() {
  const reg = dataFile('customer-banks.json');
  const QUALIFIER = ' (bank OR banking OR digital OR fintech OR app OR platform OR AI)';
  const NEGATIVES = ' -stock -shares -"price target" -upgrade -downgrade -lawsuit -"class action" -earnings -13F';
  return reg.banks
    .filter((b) => b.tier === 'A')
    .map((b) => ({
      registry: 'customer', source_key: 'customer:' + b.name, label: b.name, kind: 'google_news',
      url: googleNewsUrl('"' + b.name + '"' + QUALIFIER + NEGATIVES), active: true, window_days: 7
    }));
}

function competitorTargets() {
  const reg = dataFile('competitor-watch.json');
  const byName = new Map();
  for (const v of reg.cross_cutting || []) byName.set(v.name, v.query);
  for (const entries of Object.values(reg.by_lob || {})) {
    for (const v of entries) if (!/^See /i.test(v.category || '')) byName.set(v.name, v.query);
  }
  return [...byName.entries()].map(([name, query]) => ({
    registry: 'competitor', source_key: 'competitor:' + name, label: name, kind: 'google_news',
    url: googleNewsUrl(query), active: true, window_days: 7
  }));
}

// Reddit is deliberately excluded from this audit. reddit-sources.json now
// has one URL per subreddit (see load-reddit-sources.js), so it COULD be
// probed per-source the way RSS/competitor/AI are — but Reddit has already
// hard-blocked this workflow twice on unusual request patterns (429s from an
// unspaced burst, then a WAF 403 from a combined-subreddit URL; see
// reddit-sources.json's access_method_history), and this script has no
// reason to hit the same host 16 times in one unspaced shot just to check
// liveness. Reddit health is monitored via source_health / ingest_scans from
// real (spaced, User-Agent'd) scheduled runs instead.

// ---- probe ---------------------------------------------------------------

async function probe(target) {
  const startedAt = Date.now();
  try {
    const res = await fetch(target.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    const contentType = res.headers.get('content-type') || '';
    const isFeed = looksLikeFeed(text);
    const entries = isFeed ? parseFeedEntries(text) : [];
    const cutoff = Date.now() - target.window_days * 24 * 60 * 60 * 1000;
    const dated = entries.map((e) => new Date(e.published || 0).getTime()).filter((t) => t);
    const newest = dated.length ? new Date(Math.max(...dated)).toISOString() : null;
    const inWindow = dated.filter((t) => t >= cutoff).length;
    return {
      ...target,
      http_status: res.status,
      content_type: contentType,
      parseable: isFeed,
      total_entries: entries.length,
      newest_item_date: newest,
      in_window_count: inWindow,
      elapsed_ms: Date.now() - startedAt,
      error: null
    };
  } catch (e) {
    return {
      ...target, http_status: 0, content_type: '', parseable: false, total_entries: 0,
      newest_item_date: null, in_window_count: 0, elapsed_ms: Date.now() - startedAt, error: String(e && e.message || e)
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx !== -1 ? args[onlyIdx + 1] : null;

  let targets = [...rssTargets(), ...aiTargets(), ...customerTargets(), ...competitorTargets()];
  if (only) targets = targets.filter((t) => t.registry === only);

  if (!asJson) console.error(`[audit] probing ${targets.length} endpoints (spaced 350ms apart)...`);
  const results = [];
  for (const t of targets) {
    results.push(await probe(t));
    await new Promise((r) => setTimeout(r, 350));
  }

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    const header = ['registry', 'source_key', 'kind', 'active', 'http', 'parseable', 'in_window', 'newest', 'error'];
    console.log(header.join('\t'));
    for (const r of results) {
      console.log(
        [
          r.registry, r.source_key, r.kind, r.active,
          r.http_status, r.parseable, r.in_window_count,
          r.newest_item_date ? r.newest_item_date.slice(0, 10) : '-',
          r.error || ''
        ].join('\t')
      );
    }
    const activeBroken = results.filter((r) => r.active && (!r.parseable || r.http_status >= 400));
    console.log(`\n${results.length} endpoints probed, ${activeBroken.length} ACTIVE-path failures.`);
    if (activeBroken.length) {
      console.log('Failing active endpoints:');
      for (const r of activeBroken) console.log(`  - ${r.registry}/${r.source_key} (${r.kind}): http=${r.http_status} parseable=${r.parseable} ${r.error || ''}`);
    }
  }

  const activeBroken = results.filter((r) => r.active && (!r.parseable || r.http_status >= 400));
  process.exit(activeBroken.length ? 1 : 0);
}

main();
