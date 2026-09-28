// Diagnostic only — NOT wired into the workflow and not in CODE_OVERRIDES.
// Drop a Code node (Run Once for All Items) alongside Compute Canonical URL,
// feed it from Merge All Sources, and it collapses the whole pool into one
// summary item small enough to read or paste into a chat.
//
// What it answers: is the mix healthy, does every branch carry LOB routing
// hints, and how much of the pool is Google News items whose "snippet" is
// just the headline repeated back.

const BANKING_LOBS = ['wealth', 'sme_commercial', 'retail', 'digital_assist'];
const pool = $input.all().map((i) => i.json);

const tally = (items, key) =>
  items.reduce((acc, a) => {
    const k = a[key] || '(none)';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

const sortDesc = (obj, limit) =>
  Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit || 999)
    .map(([k, v]) => `${k}: ${v}`);

// A Google News contentSnippet is the title with the publisher appended, so
// once whitespace is collapsed it contains no words the title did not already
// have. Those items reach the curator as headline-only.
const isTitleOnly = (a) => {
  const t = (a.title || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const c = (a.content || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!c) return true;
  const head = t.split(' - ').slice(0, -1).join(' - ') || t;
  return c.length <= head.length + 30;
};

const byType = {};
for (const a of pool) {
  const t = a.source_type || '(none)';
  byType[t] = byType[t] || { total: 0, with_banking_lob: 0, title_only: 0, no_tags: 0 };
  byType[t].total++;
  const tags = a.lob_tags || [];
  if (tags.some((x) => BANKING_LOBS.includes(x))) byType[t].with_banking_lob++;
  if (!tags.length) byType[t].no_tags++;
  if (isTitleOnly(a)) byType[t].title_only++;
}

const lobSpread = {};
for (const a of pool) for (const t of a.lob_tags || []) lobSpread[t] = (lobSpread[t] || 0) + 1;

return [
  {
    json: {
      pool_size: pool.length,
      by_source_type: Object.entries(byType)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([type, s]) =>
          `${type}: ${s.total} (banking LOB ${s.with_banking_lob}, no tags ${s.no_tags}, headline-only ${s.title_only})`
        ),
      lob_tag_spread: sortDesc(lobSpread),
      top_publishers: sortDesc(tally(pool, 'source_name'), 15),
      top_customers: sortDesc(tally(pool.filter((a) => a.is_customer_news), 'customer_name'), 10),
      competitors_named: sortDesc(tally(pool.filter((a) => a.is_competitive), 'competitor_name'), 10),
      headline_only_share:
        Math.round((pool.filter(isTitleOnly).length / Math.max(pool.length, 1)) * 100) + '%'
    }
  }
];
