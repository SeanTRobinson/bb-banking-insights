// Node: "Match PR Newswire to Customers" (Code, Run Once for All Items)
// Input: raw feed text from the "PR Newswire Fetch" HTTP node (one item,
// field bodyOf() unwraps — see shared/pool-helpers.js).
//
// Self-contained: this node is a sibling of 'Load Customer Banks (Tier A)',
// not a descendant, so it cannot use $('Load Customer Banks (Tier A)'). Reads
// the full Tier A + Tier B roster straight from the registry instead of the
// second hand-maintained copy that used to live in this file.

// @data ../data/customer-banks.json as CUSTOMER_REGISTRY_FULL

// @include shared/pool-helpers.js   <- resolved by build-workflow.mjs; this
//     file is not runnable as-is. To patch this node by hand, paste the output of
//     `node newsletter/n8n/build-workflow.mjs --node "Match PR Newswire to Customers"`, not this file.

const banks = CUSTOMER_REGISTRY_FULL.banks;
const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
const candidates = banks
  .flatMap((b) => (b.aliases || [b.name]).map((alias) => ({ alias, name: b.name })))
  .sort((x, y) => y.alias.length - x.alias.length);

function matchIn(text, candidates) {
  for (const c of candidates) {
    if (new RegExp('\\b' + escapeRe(c.alias) + '\\b', 'i').test(text)) return c;
  }
  return null;
}

const input = $input.all()[0];
const raw = input ? bodyOf(input.json) : '';

// _fetch_event marker items carry this branch's health into the same pool
// Compute Canonical URL sees, rather than a side channel that can silently
// stop being wired up. 'Build Coverage Report' consumes and strips them
// before canonicalization; see pool-stats.js.
function fetchEvent(status, extra) {
  return {
    json: Object.assign(
      { _fetch_event: true, source_key: 'pr:newswire', source_type: 'pr_newswire', source_name: 'PR Newswire', status },
      extra
    )
  };
}

const out = [];
if (!raw) {
  out.push(fetchEvent('error', { error: 'empty response body' }));
} else if (!looksLikeFeed(raw)) {
  out.push(fetchEvent('error', { error: 'response is not a feed (challenge page or HTML)' }));
} else {
  const entries = parseFeedEntries(raw);
  let kept = 0;
  for (const a of entries) {
    const d = new Date(a.published || 0).getTime();
    if (!d || d < sevenDaysAgo) continue;
    const text = a.title + ' ' + a.content;
    const hit = matchIn(text, candidates);
    if (!hit) continue;
    kept++;
    out.push({
      json: {
        source_type: 'customer_news',
        source_key: 'customer:' + hit.name,
        source_name: 'PR Newswire',
        title: a.title,
        link: a.link,
        published_date: a.published || '',
        content: a.content,
        // Was [], so a bank's own press release could only ever reach Customer
        // Radar — even when it announced exactly the kind of retail or SME
        // launch a LOB section exists to cover.
        lob_tags: inferLobTags(text),
        is_customer_news: true,
        customer_name: hit.name,
        is_competitive: false,
        competitor_name: '',
        ai_research: false
      }
    });
  }
  out.push(fetchEvent(
    entries.length === 0 ? 'empty' : kept === 0 ? 'filtered_empty' : 'ok',
    { item_count: kept, raw_count: entries.length }
  ));
}

return out;
