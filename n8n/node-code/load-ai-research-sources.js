// Node: "Load AI Research Sources" (Code, Run Once for All Items)
// Output: one item per source (RSS or Google News query) -> "AI Research Fetch"
//
// Was a hand-maintained array duplicating newsletter/data/ai-research-sources.json
// (see load-rss-sources.js for why that duplication is the actual problem).

// @data ../data/ai-research-sources.json as AI_REGISTRY

const WHEN = ' when:7d';
function googleNewsUrl(query) {
  return 'https://news.google.com/rss/search?q=' +
    encodeURIComponent(query + WHEN) + '&hl=en&gl=US&ceid=US:en';
}

// 'origin' tells Normalize AI Research Item which items need the relevance-
// lens gate: general_ai_rss is genuinely "AI news in general" (mainstream
// tech press), so it is the branch that can drift into "AI Research Radar is
// now a tech-news digest" if nothing gates it. targeted_google_news_queries
// is on-thesis by construction (the query itself names the lens), so it skips
// the gate rather than risk a false-negative drop on a precision query.
const rss = (AI_REGISTRY.general_ai_rss || [])
  .filter((s) => s.status !== 'quarantined')
  .map((s) => ({ source_key: s.source_key, source_type: 'ai_research', source_name: s.name, url: s.url, cap: s.cap || 8, origin: 'general' }));

const googleNews = (AI_REGISTRY.targeted_google_news_queries || []).map((s) => ({
  source_key: s.source_key,
  source_type: 'ai_research',
  source_name: s.name,
  url: googleNewsUrl(s.query),
  cap: s.cap || 20,
  origin: 'targeted'
}));

return [...rss, ...googleNews].map((s) => ({ json: s }));
