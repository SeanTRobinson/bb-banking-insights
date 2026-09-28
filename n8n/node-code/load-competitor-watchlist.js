// Node: "Load Competitor Watchlist" (Code, Run Once for All Items)
// Output: one item per vendor -> "Competitor Google News" HTTP fetch
//
// Was a hand-maintained array duplicating newsletter/data/competitor-watch.json
// — and the hand-maintained copy was missing "Salesforce Service Cloud /
// Agentforce" entirely, the single most directly-relevant Digital Assist
// competitor in the whole registry, because nothing forced the two to agree.

// @data ../data/competitor-watch.json as COMPETITOR_REGISTRY

const WHEN = ' when:7d';
function withWindow(query) {
  return query + WHEN;
}

// Every Load* node now emits a fully-built 'url', not just a query fragment,
// so 'Competitor Google News' can use the exact same uniform HTTP Request
// parameters (url: {{ $json.url }}) as every other fetch node.
function googleNewsUrl(query) {
  return 'https://news.google.com/rss/search?q=' + encodeURIComponent(query) + '&hl=en&gl=US&ceid=US:en';
}

// The registry cross-references a vendor into more than one LOB (Temenos in
// sme_commercial, Q2 Holdings in retail, Alkami/Lumin Digital in
// sme_commercial from 2026-09-24's Jarno feedback) with a "See <group>"
// pointer instead of a duplicate entry, so one vendor produces one query and
// one story never gets double-counted across sections.
//
// This used to be a single pass over cross_cutting then by_lob, resolving
// pointers as it went — which meant a pointer only worked if the vendor's
// real entry happened to already be in byName, i.e. only if the real entry's
// group was processed earlier in object-key order. Temenos (real entry in
// cross_cutting, processed first) and Q2 Holdings (real entry in
// sme_commercial, processed before retail) worked by luck of ordering.
// Alkami and Lumin Digital's real entries are in retail, which is processed
// AFTER sme_commercial — a "See retail" pointer filed under sme_commercial
// silently found nothing and no-opped. Two passes removes the ordering
// dependency entirely: every real entry is loaded first, regardless of which
// section it's in, then every pointer is resolved against the complete set.
const byName = new Map();

function isPointer(v) {
  return /^See /i.test(v.category || '');
}

// Pass 1: every real (non-pointer) entry, cross_cutting and by_lob alike.
for (const v of COMPETITOR_REGISTRY.cross_cutting || []) {
  if (isPointer(v)) continue; // cross_cutting has never carried pointers, but don't assume it never will
  byName.set(v.name, {
    name: v.name,
    aliases: v.aliases || [v.name],
    query: v.query,
    lobTags: new Set(v.lob_tags || ['cross_cutting'])
  });
}

for (const [lobKey, entries] of Object.entries(COMPETITOR_REGISTRY.by_lob || {})) {
  for (const v of entries) {
    if (isPointer(v)) continue;
    if (byName.has(v.name)) {
      byName.get(v.name).lobTags.add(lobKey);
    } else {
      byName.set(v.name, {
        name: v.name,
        aliases: v.aliases || [v.name],
        query: v.query,
        lobTags: new Set([lobKey])
      });
    }
  }
}

// Pass 2: every pointer, now that every real entry (whichever section it
// lives in) is guaranteed to already be in byName.
const unresolvedPointers = [];

for (const v of COMPETITOR_REGISTRY.cross_cutting || []) {
  if (!isPointer(v)) continue;
  unresolvedPointers.push({ name: v.name, targetLob: null }); // cross_cutting pointers aren't a real case today; kept for symmetry
}

for (const [lobKey, entries] of Object.entries(COMPETITOR_REGISTRY.by_lob || {})) {
  for (const v of entries) {
    if (!isPointer(v)) continue;
    const existing = byName.get(v.name);
    if (existing) {
      existing.lobTags.add(lobKey);
    } else {
      unresolvedPointers.push({ name: v.name, targetLob: lobKey });
    }
  }
}

if (unresolvedPointers.length) {
  // A pointer whose name matches no real entry anywhere is a registry typo,
  // not a quiet no-op — surface it instead of burying it the way the
  // single-pass version did.
  console.warn(
    '[competitors] unresolved "See" pointers (name mismatch with no real entry): ' +
    unresolvedPointers.map((p) => p.name + (p.targetLob ? ' -> ' + p.targetLob : '')).join(', ')
  );
}

return [...byName.values()].map((v) => {
  const query = withWindow(v.query);
  return {
    json: {
      source_key: 'competitor:' + v.name,
      source_type: 'competitor',
      source_name: v.name,
      name: v.name,
      aliases: v.aliases,
      query,
      url: googleNewsUrl(query),
      lob_tags: [...v.lobTags]
    }
  };
});
