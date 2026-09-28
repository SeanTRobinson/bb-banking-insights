// Node: "Load RSS Sources" (Code, Run Once for All Items)
// Output: one item per active source -> feeds the "RSS Fetch" HTTP node
//
// Was a hand-maintained array duplicating newsletter/data/rss-sources.json.
// The registry documented "American Banker: status working" for months after
// the feed URL started serving an HTML section page instead of RSS, because
// nothing ever read the registry at build or run time — this node's own copy
// was the only thing that mattered, and it was never wrong in a way that
// forced a look. @data makes the registry the only copy: edit
// rss-sources.json, rebuild, and this node's body regenerates from it.

// @data ../data/rss-sources.json as RSS_REGISTRY

// 'when:7d' is appended here, once, for every Google News fallback query,
// rather than baked into each query string in the registry. Centralizing it
// is what makes "every Google News query is date-scoped" a single line to
// audit instead of a property to remember on every new source.
const WHEN = ' when:7d';

function googleNewsUrl(query) {
  return 'https://news.google.com/rss/search?q=' +
    encodeURIComponent(query + WHEN) + '&hl=en&gl=US&ceid=US:en';
}

// quarantined sources are excluded from the build entirely, not just skipped
// at runtime — a dead source costs one line (flip status) instead of a
// deletion that has to be reconstructed if the source recovers.
const active = RSS_REGISTRY.sources.filter((s) => s.status !== 'quarantined');

return active.map((s) => ({
  json: {
    source_key: s.source_key,
    source_type: 'rss',
    source_name: s.name,
    // Direct sources fetch their own feed. Fallback sources fetch a Google
    // News query scoped to that publisher (site:) or, where the publisher is
    // not usefully indexed on its own (PaymentsSource, Bank Automation News —
    // see rss-sources.json notes), a topic query instead. Either way this
    // node emits exactly one URL per source, so 'RSS Fetch' stays a single
    // uniform HTTP call regardless of which path a given source takes.
    url: s.fetch.method === 'google_news' ? googleNewsUrl(s.fetch.query) : s.fetch.url,
    is_fallback: s.fetch.method === 'google_news',
    lob_tags: s.lob_tags || [],
    cap: s.cap || 12,
    window_days: s.window_days || 7
  }
}));
