// Node: "Load Reddit Sources" (Code, Run Once for All Items)
// Output: one item per subreddit in reddit-sources.json (16 as of the v4
// registry) -> feeds the "Reddit Loop" (Loop Over Items, batch size 1) node,
// which hands them to "Reddit Fetch" (native RSS Feed Read) one at a time.
//
// v2/v3 fetched this via an HTTP Request node instead (a combined multireddit
// URL, then one request per subreddit) because the native RSS Feed Read node
// cannot set a custom User-Agent on its own — that had to be bolted on via
// the HTTP node's headers. v4 goes back to the native node anyway: its
// hardcoded User-Agent (`rss-parser`) is a far more common, less
// bot-fingerprint-able string than the bespoke "BackbaseInsights/1.0 ...
// ingestion" one the HTTP node was sending, which is itself a plausible
// cause of the WAF 403s that shape-of-URL changes alone did not fix. See
// reddit-sources.json's access_method_history for the full version history.
//
// The tradeoff: the native RSS Feed Read node has no batching/interval option
// of its own (the HTTP Request node did), so fetching 16 subreddit URLs
// through it requires the "Reddit Loop" + "Reddit Wait" wrapper this node
// feeds into. That spacing is the load-bearing part, measured twice: hand the
// node all 16 URLs at once and Reddit answers the first and fails the other
// 15 — v1's failure in 2025, reproduced exactly in Sept 2026.
//
// Note `subreddit` and `priority` below are emitted for readability of this
// node's own output only; Normalize Reddit Item recovers each entry's
// subreddit from the /r/<sub>/ permalink and reads `lob_hint` from the
// inlined reddit-sources.json registry, not from this item. lob_hint is still
// emitted here so a canvas inspection of Load Reddit Sources shows the
// editorial routing (added 2026-09-24 for r/smallbusiness -> sme_commercial).

// @data ../data/reddit-sources.json as REDDIT_REGISTRY

const params = REDDIT_REGISTRY.collection_params;
const limit = params.limit_per_request || 20;
const listing = params.listing || 'top';
const timeFilter = params.time_filter || 'week';

const feed = (sub) =>
  'https://www.reddit.com/r/' + sub + '/' + listing + '/.rss?t=' + timeFilter + '&limit=' + limit;

return REDDIT_REGISTRY.subreddits.map((s) => ({
  json: {
    source_key: 'reddit:r_' + s.name,
    source_type: 'reddit',
    source_name: 'r/' + s.name,
    subreddit: s.name,
    priority: s.priority || 'low',
    // Editorial LOB routing for subreddits known to belong to one section
    // (e.g. r/smallbusiness -> sme_commercial), set in reddit-sources.json.
    // Normalize Reddit Item merges this with keyword inference rather than
    // replacing it, so a post can still land in a second section on its own
    // text.
    lob_hint: s.lob_hint || null,
    url: feed(s.name)
  }
}));
