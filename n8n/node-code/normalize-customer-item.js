// Node: "Normalize Customer Item" (Code, Run Once for All Items)
// Input:  Customer Google News  (raw RSS text, one response per bank query)
// Output: pool items for Customer Radar, plus one _fetch_event marker per
//         bank for the coverage report
//
// This branch produced roughly two thirds of the whole pool and most of its
// noise, because a Google News query for a bank's name returns everything
// that name touches: 13F filings, analyst rating changes, the stadium it
// sponsors, and the Spanish city it shares a name with. Several things
// changed:
//
//   Alias matching runs against the headline with the publisher stripped.
//   "Ukrainians become target of Poland's populist rhetoric - RBC-Ukraine"
//   matched "RBC" inside the outlet's name, so Ukraine war coverage arrived
//   labelled Royal Bank of Canada.
//
//   Market-data aggregators are dropped outright. MarketBeat, TipRanks,
//   GuruFocus and friends publish a templated item per bank per day; they
//   crowded out the editorial sources at the curator cap without ever being
//   newsworthy. That list now lives in shared/pool-helpers.js so the
//   competitor branch gets the identical protection.
//
//   load-customer-banks.js's query itself now carries a banking/product
//   qualifier and explicit negative terms (see that file), roughly halving
//   volume before this normalizer even runs. ANALYST_NOISE_RE below catches
//   what still gets through — analyst-rating and litigation titles that
//   mention "bank" incidentally (e.g. "X Bank shares fall on downgrade").
//
//   The pairedItem bank-name fallback is gone. rssFeedRead does not populate
//   pairedItem so it never fired, and had it ever started working it would
//   have stamped a bank's name on articles that never mention it. Bank
//   identity is still resolved by alias text-matching (a Google News query
//   for "Deutsche Bank" can still return an item that is not actually about
//   Deutsche Bank), but $('Load Customer Banks (Tier A)').itemMatching(i)
//   now recovers which query produced this response, for health reporting.

// @include shared/pool-helpers.js   <- resolved by build-workflow.mjs; this
//     file is not runnable as-is. To patch this node by hand, paste the output of
//     `node newsletter/n8n/build-workflow.mjs --node "Normalize Customer Item"`, not this file.

const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
const banks = $('Load Customer Banks (Tier A)').all().map((i) => i.json);
const candidates = banks
  .flatMap((b) => (b.aliases || [b.name]).map((alias) => ({ alias, name: b.name })))
  .sort((x, y) => y.alias.length - x.alias.length);

// A bank's name attaches to things that are not the bank. These are the cases
// the first edition actually surfaced; extend it when a new one shows up.
const NOT_THE_BANK = [
  /\bbank park\b/i,
  /\bbarclays (cent(er|re)|arena)\b/i,
  /\bkeybank cent(er|re)\b/i,
  /\brbc heritage\b/i,
  /\b(wsl|women's super league|la liga|premier league|matchday|free ?kick|golf|marathon|phillies)\b/i,
  /\b(city|port) of santander\b/i,
  /\bracing de santander\b/i
];

// Real coverage of a bank says something bank-shaped somewhere. Deliberately
// broad — this is here to drop the ferry timetables and museum openings, not
// to judge newsworthiness, which is the curator's job.
const BANKING_CUE = new RegExp(
  '\\b(bank|banking|financial|finance|lender|lending|loan|mortgage|deposit|' +
  'credit|payment|branch|customer|client|account|fintech|digital|app|platform|' +
  'ceo|chief executive|earnings|revenue|profit|acquisition|merger|layoff|job|' +
  'staff|hiring|regulator|compliance|fraud|atm|card|wealth|advisor|adviser|' +
  'treasury|launch|partnership|ai)s?\\b',
  'i'
);

function matchIn(text, list) {
  for (const c of list) {
    if (new RegExp('\\b' + escapeRe(c.alias) + '\\b', 'i').test(text)) return c;
  }
  return null;
}

// Ceiling per bank: a single query occasionally returns 40-60 items when a
// bank has an eventful week, which would let one account dominate the branch
// the same way Wealth Management Magazine dominated RSS before it had a cap.
const PER_CUSTOMER_CAP = 12;

const out = [];

for (let i = 0; i < $input.all().length; i++) {
  const item = $input.all()[i];
  const source = $('Load Customer Banks (Tier A)').itemMatching(i).json;
  const raw = bodyOf(item.json);

  function fetchEvent(status, extra) {
    return {
      json: Object.assign(
        { _fetch_event: true, source_type: 'customer', source_key: source.source_key, url: source.url, status },
        extra
      )
    };
  }

  if (!raw) {
    out.push(fetchEvent('error', { error: 'empty response body' }));
    continue;
  }
  if (!looksLikeFeed(raw)) {
    out.push(fetchEvent('error', { error: 'response is not a feed (challenge page or HTML)' }));
    continue;
  }

  const entries = parseFeedEntries(raw);
  let kept = 0;

  for (const a of entries) {
    if (kept >= PER_CUSTOMER_CAP) break;
    const d = new Date(a.published || 0).getTime();
    if (!d || d < sevenDaysAgo) continue;

    const publisher = publisherFromTitle(a.title);
    if (isBlockedPublisher(publisher)) continue;

    const text = headlineOf(a.title) + ' ' + (publisher ? a.content.split(publisher).join(' ') : a.content);
    if (NOT_THE_BANK.some((re) => re.test(text))) continue;
    if (ANALYST_NOISE_RE.test(headlineOf(a.title))) continue;
    if (!BANKING_CUE.test(text)) continue;

    const hit = matchIn(text, candidates);
    if (!hit) continue;

    // BANKING_CUE above already confirmed this item says something
    // bank-shaped; LOB_KEYWORDS is a narrower, product-specific vocabulary
    // and plenty of real customer news (earnings, hiring, a generic "digital
    // banking" launch) clears the first without hitting the second. Falling
    // through to an empty array here reproduces the exact routing-signal bug
    // this normalizer was rewritten to fix (see the file banner above) — tag
    // those as cross_cutting instead of untagged, same as the registry does
    // for competitor entries that aren't specific to one LOB.
    const lobTags = inferLobTags(text);

    kept++;
    out.push({
      json: {
        source_type: 'customer_news',
        source_key: 'customer:' + hit.name,
        source_name: publisher || hostOf(a.link) || 'Google News',
        title: a.title,
        link: a.link,
        published_date: a.published || '',
        content: a.content,
        lob_tags: lobTags.length ? lobTags : ['cross_cutting'],
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
