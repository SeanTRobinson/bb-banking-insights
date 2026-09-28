# Quarterly source audit

Every direct feed URL, Google News fallback query, and vendor/customer query
in `data/*.json` can silently rot: a publisher retires an RSS endpoint, adds
a Cloudflare WAF, moves to a new path, or a Google News query's precision
drifts as new stories use the same keywords. This is the process for
catching that on a schedule, rather than only when a section quietly comes
back thin.

Run it once a quarter, or any time `ingest_scans`/`source_health` (Supabase)
show a source degrading between audits — see
[`docs/handoff.md`](handoff.md) "Scan-only mode and the coverage gate" for
how those two tables work run-to-run.

## 1. Run the automated probe

```bash
node newsletter/n8n/audit-sources.mjs
```

This probes **every** endpoint in `rss-sources.json`, `ai-research-sources.json`,
`customer-banks.json`, and `competitor-watch.json` — both the endpoint the
workflow actually uses today (`active: true`) and, for RSS sources on a
Google News fallback, the dormant direct URL too (`active: false`), so a WAF
that lifted shows up here before you'd otherwise notice. For each one it
reports HTTP status, content type, whether it parses as a feed
(`shared/pool-helpers.js`'s own `looksLikeFeed`/`parseFeedEntries` — the
exact parser the workflow runs, not a second copy), the newest in-feed item
date, and the in-window item count.

Exit code is `1` if any **active** endpoint fails to parse or returns an
HTTP error — safe to wire into a CI cron and treat as a real check:

```bash
node newsletter/n8n/audit-sources.mjs --json > /tmp/audit-$(date +%F).json
```

Reddit is intentionally excluded — see the script's own comment for why
(two fixed multireddit URLs, not a per-source list, and one-shot probing
fights its own throttling logic). Reddit health comes from
`source_health`/`ingest_scans` on real runs instead.

To audit one registry at a time (useful while chasing a single failure):

```bash
node newsletter/n8n/audit-sources.mjs --only rss
node newsletter/n8n/audit-sources.mjs --only ai_research
node newsletter/n8n/audit-sources.mjs --only customer
node newsletter/n8n/audit-sources.mjs --only competitor
```

## 2. Triage what changed

For each `active: false` (dormant direct URL) that now returns `200` +
`parseable: true`: the WAF or the dead path may have lifted. Flip that
source's `fetch.method` back to `"direct"` in `rss-sources.json` and
re-audit before committing — a single successful probe is not enough
signal; confirm it holds across a re-run spaced a few minutes apart, since
some WAFs allow through the first request in a burst.

For each `active: true` that now fails: this is the thing worth fixing
before the next scheduled run degrades. In order of likely cause:

1. **HTTP 403/429, `parseable: false`, but `http_status` non-zero** — new or
   tightened WAF/rate limit. Try a Google News `site:` fallback (see how
   every other `google_news` entry in `rss-sources.json` is shaped) before
   assuming the source is unrecoverable.
2. **HTTP 404** — path moved. Check the publisher's site directly for a new
   feed URL (view-source on their blog/news index often still has a
   `<link rel="alternate" type="application/rss+xml">` tag pointing at it).
3. **HTTP 200, `parseable: false`** — the URL now serves an HTML page (a
   redirected/retired feed) instead of RSS/Atom. Same fix as #2.
4. **`parseable: true`, `in_window_count: 0`, but `newest_item_date` is
   old** — not a fetch problem, just a quiet source. Leave `status:
   "working"` and consider whether `window_days` should widen (see the
   sparse-regulatory-cadence sources in `rss-sources.json` for the pattern)
   rather than treating this as broken.
5. **A Google News query's precision has drifted** (checked by eye, not by
   this script — read a sample of `content` from a real or scan-only run,
   not just the probe's item counts) — tighten the query the same way
   `competitor-watch.json`'s Sierra entry was tightened (add banking/product
   qualifiers, `-negative` terms), and re-run a scan-only pass (`data/reddit-sources.json`'s Manual Scan Trigger — see `docs/handoff.md`) to
   confirm the keep-rate improved before committing.

## 3. Make the change and verify

1. Edit the registry file(s) under `data/*.json` — this is the **only**
   place to edit. `build-workflow.mjs`'s `@data` directive generates every
   `Load ... Sources` Code node directly from these files at build time;
   there is no second copy to keep in sync by hand.
2. Rebuild:
   ```bash
   node newsletter/n8n/build-workflow.mjs
   ```
   This re-validates that every registry still has at least one active
   source and that the wiring is intact — it exits non-zero and refuses to
   write the JSON if something is now broken.
3. Run the test suite:
   ```bash
   npm test
   ```
   `registry-loader-parity.test.mjs` will catch a malformed registry entry
   (missing required field, wrong shape) before it ever reaches n8n.
4. Re-run the probe for just the branch you touched
   (`--only rss` etc.) to confirm the fix actually works against the live
   endpoint, not just that the JSON is well-formed.
5. Re-import `backbase-insights-v4.json` in n8n (or hand-patch the single
   changed node via `node newsletter/n8n/build-workflow.mjs --node "Load RSS Sources"`,
   pasted over that one node — see `docs/handoff.md` "Making changes").
6. Run a **scan-only** pass (Manual Scan Trigger) and check the new
   `Record Ingest Scan Row` output: `gate_passed`, `metrics.coverage_pct`,
   and the per-branch breakdown should reflect the fix without spending a
   single Claude token.

## 4. What this audit is not

It is not a substitute for the pre-LLM coverage gate (`Build Coverage
Report` -> `Apply Coverage Gate` — see `docs/handoff.md`), which runs on
**every** scan-only, dry, and full run and stops a run automatically if
active-source coverage, RSS contributor count, Reddit diversity, or pool
size fall below their floors. The quarterly audit exists to catch slow drift
(a WAF that appeared last month, a query whose precision degraded) between
those automatic per-run checks, and to re-validate the *dormant* endpoints
(quarantined sources, direct URLs sitting behind a fallback) that a normal
run never touches at all.
