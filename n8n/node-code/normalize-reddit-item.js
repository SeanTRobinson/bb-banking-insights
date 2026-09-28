// Node: "Normalize Reddit Item" (Code, Run Once for All Items)
// Input:  Reddit Loop's DONE output — the RAW output of n8n's native RSS Feed
//         Read node for every subreddit, flattened together once the loop has
//         been round all of them (Loop Over Items "combines all of the
//         processed data and returns it through the done output" — n8n's own
//         description). Items are rss-parser's own shape, NOT anything this
//         repo attached:
//           { title, link, pubDate, author, content, contentSnippet, id, isoDate }
//         ...plus a bare {} for any subreddit that returned nothing at all
//         (Reddit Fetch has alwaysOutputData on, so an empty or failed fetch
//         still emits one placeholder rather than stalling the loop).
// Output: at most REDDIT_CAP pool items, newest week only, plus one
//         _fetch_event marker per subreddit for the coverage report.
//
// This node identifies each entry's subreddit by PARSING IT OUT OF THE LINK
// (every Reddit permalink is /r/<sub>/comments/...), not from a field an
// upstream node attached. That is deliberate and is the third attempt at this
// problem:
//   1. v1-v3 fetched via an HTTP Request node, one response per subreddit, and
//      recovered identity with $('Load Reddit Sources').itemMatching(i) — fine
//      when responses and requests are 1:1.
//   2. v4 moved to the native RSS Feed Read node (see reddit-sources.json's
//      access_method_history for the User-Agent reasoning). That node explodes
//      ONE input URL into N output entries, so requests and responses are no
//      longer 1:1 and itemMatching has to resolve through pairedItem lineage
//      that the node may simply not propagate — when it doesn't, the
//      expression throws and takes the whole loop iteration down with it.
//      Dedicated "Tag Reddit Item"/"Tag Reddit Failure" nodes were tried to
//      stamp identity on inside the loop; that is a live node whose only job
//      is to restate something the data already contains.
//   3. Now: the link is self-identifying, so nothing needs to be carried.
//      Fewer nodes, no lineage dependency, and the normalizer works whether or
//      not anything upstream tagged the items (an explicit `subreddit` field is
//      still honoured if present, so a tagged workflow keeps working too).
//
// Cross-subreddit balancing has to happen HERE rather than at fetch time: a
// single-subreddit /top/ feed only ranks within that subreddit, and the
// combined-multireddit URL that used to buy a genuine global ranking is what
// got WAF-blocked. See reddit-sources.json's selection_rule.

// @include shared/pool-helpers.js   <- resolved by build-workflow.mjs; this
//     file is not runnable as-is. To patch this node by hand, paste the output of
//     `node newsletter/n8n/build-workflow.mjs --node "Normalize Reddit Item"`, not this file.

// @data ../data/reddit-sources.json as REDDIT_REGISTRY

// Ceiling on Reddit's share of the pool. The branch is one voice among five
// and sixteen subreddits' worth of entries would otherwise let it outvote
// every trade publication we have. Mirrors reddit-sources.json's
// collection_params.reddit_cap — keep them in sync.
const REDDIT_CAP = 100;

// Ceiling on any ONE subreddit's contribution, so a high-volume subreddit
// cannot crowd out the rest of the roster. Measured cause of a real problem:
// FinancialCareers alone took 44 of 100 slots in the old combined-multireddit
// design before a cap like this existed. Mirrors reddit-sources.json's
// collection_params.per_sub_cap — keep them in sync.
const PER_SUB_CAP = 12;

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

// Reddit's own casing for a subreddit in a permalink does not always match the
// registry's ('/r/Banking/' vs 'banking'), so matching is case-insensitive —
// but the REGISTRY spelling is what gets written into source_key/source_name.
// That matters: source_health rows are keyed on source_key, and a run that
// suddenly reported 'reddit:r_Banking' would start a second, parallel history
// for the same subreddit.
const registryBySub = new Map();
for (const s of REDDIT_REGISTRY.subreddits) {
  registryBySub.set(s.name.toLowerCase(), { name: s.name, priority: s.priority || 'low' });
}

// Every Reddit permalink carries its subreddit: /r/<sub>/comments/<id>/<slug>.
function subredditOf(link) {
  const m = /\/r\/([A-Za-z0-9_]+)/.exec(link || '');
  return m ? m[1] : '';
}

const bySubMap = new Map();
for (const s of REDDIT_REGISTRY.subreddits) {
  bySubMap.set(s.name, {
    priority: s.priority || 'low',
    source_key: 'reddit:r_' + s.name,
    lob_hint: s.lob_hint || null,
    raw: []
  });
}

let placeholders = 0;
let unknown = 0;

for (const wrapped of $input.all()) {
  const it = wrapped.json || {};

  // The alwaysOutputData placeholder for a subreddit that returned nothing.
  // It carries no identity whatsoever, so it cannot be attributed — which is
  // why 'error' is no longer distinguishable from 'empty' per subreddit; see
  // the event-status comment below.
  if (!it.link && !it.title) {
    placeholders++;
    continue;
  }

  // An explicit field wins if some upstream node did attach one; otherwise the
  // link is the source of truth.
  const derived = it.subreddit || subredditOf(it.link);
  const hit = registryBySub.get(String(derived).toLowerCase());
  if (!hit) {
    unknown++;
    continue;
  }
  bySubMap.get(hit.name).raw.push(it);
}

const seen = new Set();
// One entry per subreddit, in registry order — sorted into priority order
// below, right before the round-robin fill.
const bySub = [];
const events = [];

for (const [sub, bucket] of bySubMap) {
  const kept = [];

  for (const a of bucket.raw) {
    if (kept.length >= PER_SUB_CAP) break;

    // rss-parser exposes Atom's <id> as `id` for Reddit's feeds ('t3_1w4pf8f'),
    // not `guid` — measured against real output. guid/link stay as fallbacks
    // rather than assuming one name.
    const id = a.id || a.guid || a.link;
    if (!id || seen.has(id)) continue;

    const ms = new Date(a.isoDate || a.pubDate || 0).getTime();
    // t=week already scopes this server-side; the check stays because a
    // subreddit whose URL loses the parameter should not quietly widen the
    // edition.
    if (!ms || ms < sevenDaysAgo) continue;

    // contentSnippet is rss-parser's HTML-stripped version of content, so it
    // is preferred; content is HTML and needs tags and entities dealt with.
    let text = a.contentSnippet
      ? String(a.contentSnippet)
      : decodeEntities(String(a.content || '')).replace(/<[^>]*>/g, ' ');

    // Reddit appends its own "submitted by /u/x [link] [comments]" trailer to
    // every entry's body. NB the shape is 'submitted by /u/name' — the older
    // 'submitted by u/name to r/sub' form this used to match does not appear
    // in rss-parser's output, so a regex requiring the 'to r/sub' half
    // silently stripped nothing and left the trailer in the body. Both forms
    // are handled now.
    text = text.replace(/submitted by\s*\/?u\/[\w-]+(\s*to\s*\/?r\/[\w-]+)?/gi, ' ');
    text = text.replace(/\[link\]|\[comments\]|\[\d+\s+comments?\]/gi, ' ');
    text = text.replace(/\s+/g, ' ').trim();

    if (text.length < 40) continue; // link-only post with no discussion body
    if (!a.title) continue;

    seen.add(id);
    kept.push({
      json: {
        source_type: 'reddit',
        source_key: 'reddit:r_' + sub,
        source_name: 'r/' + sub,
        title: a.title,
        link: a.link,
        published_date: a.isoDate || a.pubDate || '',
        content: text,
        // Was exactly ['community'], which made every Reddit post reachable
        // only from Community Pulse. r/callcentres is practitioners describing
        // Digital Assist's problem space in their own words; inferring
        // alongside the community tag lets the curator file a thread in both.
        // lob_hint (from reddit-sources.json, 2026-09-24) adds a deliberate
        // routing tag for subreddits editorially known to belong to one LOB
        // — e.g. r/smallbusiness -> sme_commercial — on top of, not instead
        // of, keyword inference, so a post still reaches a second section if
        // its own text also matches.
        lob_tags: mergeTags(
          bucket.lob_hint ? ['community', bucket.lob_hint] : ['community'],
          inferLobTags(a.title + ' ' + text)
        ),
        is_customer_news: false,
        is_competitive: false,
        competitor_name: '',
        ai_research: false,
        reddit_post_id: id
      }
    });
  }

  bySub.push({ sub, priority: bucket.priority, entries: kept });

  // No 'error' status any more, and that is a real (accepted) loss of fidelity
  // rather than an oversight: with the native RSS Feed Read node, a subreddit
  // that hard-failed and a subreddit that genuinely had nothing posted both
  // arrive as an anonymous {} placeholder, so the two cannot be told apart
  // here. Consequences, both deliberate: (1) record_source_fetch never sees an
  // 'error' for a subreddit, so no subreddit gets pushed towards quarantine on
  // Reddit's behaviour alone; (2) the coverage gate's own reddit floor does not
  // depend on this — it counts distinct subreddits present in the SURVIVING
  // POOL (see build-coverage-report.js), which is the outcome that actually
  // matters and is unaffected. A wholesale Reddit outage still shows up there
  // as reddit_subreddits collapsing below 8.
  events.push({
    source_key: bucket.source_key,
    url: '',
    status: bucket.raw.length === 0 ? 'empty' : kept.length === 0 ? 'filtered_empty' : 'ok',
    item_count: kept.length,
    raw_count: bucket.raw.length
  });
}

// Round-robin across subreddits, high priority before medium before low
// (registry order within a tier), one post from each pass before any
// subreddit gets a second. Round-robin rather than priority-then-rank-order
// because even inside one tier the sizes differ by an order of magnitude
// (FinancialCareers vs talesfromcallcenters), and taking them in order would
// just re-run the popularity contest PER_SUB_CAP already exists to prevent.
const ordered = [...bySub].sort(
  (a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
);

const out = [];
for (let rank = 0; out.length < REDDIT_CAP; rank++) {
  let placed = false;
  for (const { entries } of ordered) {
    if (rank >= entries.length) continue;
    out.push(entries[rank]);
    placed = true;
    if (out.length >= REDDIT_CAP) break;
  }
  if (!placed) break;
}

console.log(
  '[reddit] subs_with_entries=' + bySub.filter((s) => s.entries.length).length + '/' + bySub.length +
  ' kept=' + bySub.reduce((n, s) => n + s.entries.length, 0) +
  ' pool=' + out.length +
  ' empty_placeholders=' + placeholders +
  (unknown ? ' UNKNOWN_SUBREDDIT_ENTRIES=' + unknown : '')
);

for (const e of events) {
  out.push({ json: Object.assign({ _fetch_event: true, source_type: 'reddit' }, e) });
}

return out;
