// Node: "Load Competitor Watchlist" (Code, Run Once for All Items)
// Output: one item per vendor -> "Competitor Google News" HTTP fetch
//
// Was a hand-maintained array duplicating newsletter/data/competitor-watch.json
// — and the hand-maintained copy was missing "Salesforce Service Cloud /
// Agentforce" entirely, the single most directly-relevant Digital Assist
// competitor in the whole registry, because nothing forced the two to agree.

const COMPETITOR_REGISTRY = {"_comment":"Competitor registry for the full Competitor Intelligence section. Superseded from the earlier 10-vendor 'radar' stub now that this backs a dedicated section, not just a customer-radar cross-check. Grounded in Backbase's own public positioning content (backbase.com/blog comparison guides: 'Backbase vs Temenos', 'Backbase vs Salesforce', 'Q2 Holdings vs Backbase', 'Temenos vs Avaloq vs Backbase', 'Backbase vs Jack Henry'; backbase.com/press Kasisto acquisition) plus the internal competitive-landscape reference at https://backbase.atlassian.net/wiki/spaces/ID/pages/2693857362/Competitors (cited for context only — not queried at runtime from this external n8n workflow). Re-validate every quarterly audit; this market moves fast and every vendor listed here is shipping agentic-AI features on a roughly monthly cadence as of mid-2026. 2026-09-24: SME/Commercial coverage patch (Jarno) added Infosys Finacle to cross_cutting, six commercial vendors plus four 'See' pointers under by_lob.sme_commercial, and a two-pass pointer resolver in load-competitor-watchlist.js so Alkami/Lumin Digital 'See retail' pointers no longer silently no-op.","monitoring_method":"https://news.google.com/rss/search?q=<url-encoded query>&hl=en&gl=US&ceid=US:en — same technique proven for customer-bank monitoring. No vendor here publishes a usable newsroom RSS (verified during the Sprint 1 audit), so Google News query is the primary channel; a few also get picked up incidentally via the Tier 1 industry RSS feeds (Finextra, Banking Dive, American Banker) — Phase 2 extraction tags those as competitive_angle regardless of which channel surfaced them.","cross_cutting":[{"name":"Temenos","aliases":["Temenos"],"category":"Core banking + digital banking platform","query":"Temenos banking platform","lob_tags":["cross_cutting","wealth","retail"],"notes":"Broadest overlap with Backbase across segments; also active in private banking/wealth via the Avaloq comparison space."},{"name":"Finastra","aliases":["Finastra"],"category":"Core banking + digital banking platform","query":"Finastra digital banking","lob_tags":["cross_cutting","sme_commercial"]},{"name":"FIS","aliases":["FIS"],"category":"Core banking + wealth station + payments","query":"FIS Global banking technology","lob_tags":["cross_cutting","wealth"]},{"name":"Fiserv","aliases":["Fiserv","FISV"],"category":"Core banking + digital banking (Corillian legacy)","query":"Fiserv banking technology","lob_tags":["cross_cutting","retail"]},{"name":"Oracle Financial Services","aliases":["Oracle Financial Services","Oracle Banking","FLEXCUBE"],"category":"Core banking + digital banking","query":"Oracle Financial Services banking platform","lob_tags":["cross_cutting"]},{"name":"Thought Machine","aliases":["Thought Machine","Vault Core"],"category":"Cloud-native core banking","query":"Thought Machine Vault core banking","lob_tags":["cross_cutting"]},{"name":"Mambu","aliases":["Mambu"],"category":"Cloud-native core banking","query":"Mambu banking platform","lob_tags":["cross_cutting"]},{"name":"Infosys Finacle","aliases":["Finacle","Infosys Finacle"],"category":"Core banking + digital banking platform","query":"Infosys Finacle banking platform","lob_tags":["cross_cutting","sme_commercial"],"notes":"Jarno flag (SME/Commercial feedback, 2026-09-24). Strong commercial/business banking and trade finance modules; frequent presence in commercial banking RFPs alongside Backbase."}],"by_lob":{"sme_commercial":[{"name":"nCino","aliases":["nCino"],"category":"Commercial/business banking loan origination + platform","query":"nCino bank commercial lending","notes":"Most-cited direct competitor in business banking; frequently paired with Backbase in analyst comparisons."},{"name":"Q2 Holdings","aliases":["Q2 Holdings","QTWO"],"category":"Digital banking platform (business + retail)","query":"Q2 Holdings digital banking","notes":"Subject of a direct public comparison: backbase.com/blog/q2-holdings-vs-backbase."},{"name":"Jack Henry","aliases":["Jack Henry","Banno"],"category":"Core + digital banking (Banno)","query":"Jack Henry Banno business banking","notes":"Subject of a direct public comparison: backbase.com/blogs/engagement-banking (Backbase vs Jack Henry)."},{"name":"Temenos","category":"See cross_cutting","query":"Temenos business banking","notes":"Also competes here; tracked once under cross_cutting to avoid duplicate stories."},{"name":"Codat","aliases":["Codat"],"category":"SME/business data connectivity & embedded finance API","query":"Codat embedded finance business banking","notes":"Added 2026-09-24 (Jarno / SME & Commercial). Business-data API layer competing for the same embedded-finance/SME-onboarding use cases as Backbase's commercial banking proposition."},{"name":"Modulr","aliases":["Modulr"],"category":"Embedded payments/BaaS for business banking","query":"Modulr payments embedded finance","notes":"Added 2026-09-24 (Jarno / SME & Commercial)."},{"name":"ClearBank","aliases":["ClearBank"],"category":"Cloud clearing bank / BaaS for business & commercial accounts","query":"ClearBank business banking","notes":"Added 2026-09-24 (Jarno / SME & Commercial)."},{"name":"Bottomline","aliases":["Bottomline","Bottomline Technologies"],"category":"Payments, treasury & cash management software","query":"Bottomline Technologies treasury payments banking","notes":"Jarno flag (SME/Commercial feedback, 2026-09-24). Core overlap: treasury management, payments, invoice/cash management for business banking clients."},{"name":"FIS Digital One (Dragonfly)","aliases":["FIS Digital One","Dragonfly","D1"],"category":"Commercial banking digital platform (FIS product suite)","query":"FIS (\"Digital One\" OR Dragonfly) commercial banking","notes":"Jarno flag (SME/Commercial feedback, 2026-09-24). Tracked separately from the generic FIS entry (see cross_cutting) — Digital One / Dragonfly is FIS's specific commercial-banking platform play, not FIS's whole portfolio."},{"name":"Fiserv","category":"See cross_cutting","query":"Fiserv business banking commercial","notes":"Jarno flag (SME/Commercial feedback, 2026-09-24). Also competes here; tracked once under cross_cutting to avoid duplicate stories."},{"name":"FIS","category":"See cross_cutting","query":"FIS commercial banking treasury","notes":"Jarno flag (SME/Commercial feedback, 2026-09-24). Generic FIS company coverage — see FIS Digital One (Dragonfly) above for the product-specific angle. Tracked once under cross_cutting to avoid duplicate stories."},{"name":"Alkami","category":"See retail","query":"Alkami business banking commercial","notes":"Jarno flag (SME/Commercial feedback, 2026-09-24). Also competes here; tracked once under retail to avoid duplicate stories."},{"name":"Lumin Digital","category":"See retail","query":"Lumin Digital business banking","notes":"Jarno flag (SME/Commercial feedback, 2026-09-24). Also competes here; tracked once under retail to avoid duplicate stories."},{"name":"Infosys Finacle","category":"See cross_cutting","query":"Infosys Finacle commercial banking","notes":"Jarno flag (SME/Commercial feedback, 2026-09-24). Also competes here; tracked once under cross_cutting to avoid duplicate stories."}],"wealth":[{"name":"Avaloq","aliases":["Avaloq"],"category":"Wealth/private banking platform","query":"Avaloq wealth private banking","notes":"Subject of a direct public comparison: backbase.com/blog/temenos-vs-avaloq-vs-backbase."},{"name":"Salesforce Financial Services Cloud","aliases":["Financial Services Cloud"],"category":"CRM-led wealth/advisor platform","query":"Salesforce Financial Services Cloud wealth advisor","notes":"Subject of a direct public comparison: backbase.com/blog/backbase-vs-salesforce-banking."},{"name":"SEI Wealth Platform","aliases":["SEI Wealth Platform","SEI Investments","SEIC"],"category":"Wealth/advisor platform","query":"SEI Wealth Platform advisor","notes":null},{"name":"Envestnet | Tamarac","aliases":["Envestnet","Tamarac"],"category":"Advisor portfolio/rebalancing platform","query":"Envestnet Tamarac advisor platform","notes":null},{"name":"Addepar","aliases":["Addepar"],"category":"Wealth data/portfolio platform","query":"Addepar wealth platform","notes":null},{"name":"Morningstar","aliases":["Morningstar"],"category":"Advisor research/portfolio tools","query":"Morningstar advisor platform","notes":null}],"retail":[{"name":"Q2 Holdings","category":"See sme_commercial","query":"Q2 Holdings retail digital banking","notes":"Tracked once under sme_commercial to avoid duplicate stories; retains retail relevance."},{"name":"Alkami","aliases":["Alkami","ALKT"],"category":"Digital banking platform (bank + credit union)","query":"Alkami digital banking","notes":null},{"name":"NCR Voyix (Digital Insight)","aliases":["NCR Voyix","Digital Insight"],"category":"Digital banking platform","query":"NCR Voyix Digital Insight banking","notes":null},{"name":"Narmi","aliases":["Narmi"],"category":"Digital banking platform (challenger)","query":"Narmi digital banking","notes":null},{"name":"Nymbus","aliases":["Nymbus"],"category":"Digital banking platform (challenger)","query":"Nymbus digital banking","notes":null},{"name":"Bankjoy","aliases":["Bankjoy"],"category":"Digital banking platform (credit union focus)","query":"Bankjoy digital banking credit union","notes":null},{"name":"Lumin Digital","aliases":["Lumin Digital"],"category":"Digital banking platform (credit union focus)","query":"Lumin Digital banking","notes":null}],"digital_assist":[{"name":"Salesforce Service Cloud / Agentforce","aliases":["Agentforce","Salesforce Service Cloud"],"category":"Contact-centre CRM + agentic AI","query":"Salesforce Agentforce Service Cloud banking","notes":"Salesforce's agentic-AI push (Agentforce) is the most direct AI-era overlap with Digital Assist's agent tooling."},{"name":"NICE (CXone)","aliases":["NICE CXone","CXone","NICE Ltd"],"category":"Contact-centre platform + AI","query":"NICE CXone contact center AI banking","notes":null},{"name":"Genesys","aliases":["Genesys"],"category":"Contact-centre platform + AI","query":"Genesys contact center AI banking","notes":null},{"name":"Verint","aliases":["Verint"],"category":"Contact-centre platform + AI","query":"Verint contact center AI banking","notes":null},{"name":"Glia","aliases":["Glia"],"category":"Digital customer service / co-browsing platform","query":"Glia digital customer service banking","notes":null},{"name":"Kore.ai","aliases":["Kore.ai"],"category":"Conversational AI / agentic platform","query":"Kore.ai banking AI agent","notes":null},{"name":"Sierra","aliases":["Sierra AI","Sierra.ai"],"category":"Agentic AI customer service platform (new entrant)","query":"Sierra AI customer service agent bank OR banking OR financial","notes":"Fast-moving agentic-CX entrant; watch for banking-sector moves specifically. Query tightened Sept 2026 audit — the unqualified version returned 22 items/week, mostly general-CX coverage with no financial-services angle; the qualified version returns 12, same publishers, fewer off-thesis hits."},{"name":"Decagon","aliases":["Decagon"],"category":"Agentic AI customer service platform (new entrant)","query":"Decagon AI customer service agent","notes":"Same category as Sierra."}]},"note_on_kasisto":"Kasisto (conversational/agentic AI for banking) was ACQUIRED BY Backbase in June 2026 (backbase.com/press/backbase-acquires-kasisto-leading-the-industry-shift-to-agentic-banking) and must NOT be tracked as a competitor going forward. It is retained here only as a note because 'Kasisto alternatives' search traffic still surfaces in some feeds — the Phase 1 triage prompt should treat Kasisto mentions as Backbase-relevant M&A/product news, not competitive intelligence."};

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
