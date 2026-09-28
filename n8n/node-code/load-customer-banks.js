// Node: "Load Customer Banks (Tier A)" (Code, Run Once for All Items)
// Output: one item per Tier A bank -> "Customer Google News" HTTP fetch
//
// Was a hand-maintained array duplicating newsletter/data/customer-banks.json,
// AND a second hand-maintained copy of the full roster inside
// "Match PR Newswire to Customers" (a sibling branch that cannot reference
// this node). Both now read the one registry via @data.

// @data ../data/customer-banks.json as CUSTOMER_REGISTRY

// A bare bank name pulls back every analyst note, stock move and 13F filing
// that mentions it — measured on a real pool, that noise was ~10% of the
// customer branch and effectively 0% of what the curator ever kept. Adding a
// banking/product qualifier plus explicit negative terms roughly halves
// volume (Deutsche Bank: 62 -> the same query without qualifiers ran ~2x
// higher) while keeping product/ops-shaped stories. This still is not
// perfect precision — normalize-customer-item.js's ANALYST_NOISE_RE and
// bank-as-analyst filtering do the rest — but it moves the ratio enough that
// the pool cap stops being dominated by syndicated market-data noise before
// the normalizer even sees it.
const WHEN = ' when:7d';
const QUALIFIER = ' (bank OR banking OR digital OR fintech OR app OR platform OR AI)';
const NEGATIVES = ' -stock -shares -"price target" -upgrade -downgrade -lawsuit -"class action" -earnings -13F';

function buildQuery(name) {
  return '"' + name + '"' + QUALIFIER + WHEN + NEGATIVES;
}

// Every Load* node now emits a fully-built 'url', not just a query fragment,
// so 'Customer Google News' can use the exact same uniform HTTP Request
// parameters (url: {{ $json.url }}) as every other fetch node instead of
// carrying its own query-to-URL template.
function googleNewsUrl(query) {
  return 'https://news.google.com/rss/search?q=' + encodeURIComponent(query) + '&hl=en&gl=US&ceid=US:en';
}

const tierA = CUSTOMER_REGISTRY.banks.filter((b) => b.tier === 'A');

return tierA.map((b) => {
  const query = buildQuery(b.name);
  return {
    json: {
      source_key: 'customer:' + b.name,
      source_type: 'customer',
      source_name: b.name,
      name: b.name,
      query,
      url: googleNewsUrl(query),
      aliases: b.aliases || [b.name]
    }
  };
});
