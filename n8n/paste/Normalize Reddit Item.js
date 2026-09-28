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

// Shared prelude for the "Normalize * Item" Code nodes. n8n Code nodes cannot
// import, so build-workflow.mjs inlines this file into each node body that
// asks for it with an @include directive. Edit it here, never in the generated
// workflow JSON.

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// &amp; must be last or "&amp;lt;" decodes to "<" instead of "&lt;". Lifted out
// of normalize-reddit-item.js because every HTTP-fetched feed needs it now,
// not just Reddit's.
function decodeEntitiesOnce(s) {
  return (s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#0*39;|&#x0*27;/gi, "'")
    .replace(/&nbsp;|&#0*32;/gi, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

// Reddit's Atom feed double-encodes entities inside <content> — the raw XML
// contains literally "&amp;#32;", not "&#32;". Decoding once (in the correct
// &amp;-last order, so "&amp;lt;" becomes "&lt;" and not "<") turns that into
// "&#32;", a first-generation entity that then needs a second pass. A second
// pass on already-clean text is a no-op, so this is safe for every other
// feed too.
function decodeEntities(s) {
  return decodeEntitiesOnce(decodeEntitiesOnce(s));
}

// Every fetch branch now goes through an HTTP Request node instead of the
// native RSS/Reddit nodes, because none of the native nodes can set a
// User-Agent — see load-reddit-sources.js for the 429 history that forced
// this for Reddit, and rss-sources.json for the Cloudflare 403 history that
// forced it for industry RSS. Response Format is fixed to Text everywhere, so
// this is the one place that unwraps whichever field n8n put it in.
function bodyOf(json) {
  if (typeof json === 'string') return json;
  if (!json) return '';
  for (const key of ['data', 'body', 'text']) {
    if (typeof json[key] === 'string') return json[key];
  }
  return '';
}

// Cloudflare (and most other bot walls) answer a blocked request with HTTP
// 200 and an HTML "Just a moment..." interstitial, not an error status — the
// fetch node sees success and hands this straight to the parser. Checked
// against real captures from Finextra, The Financial Brand, FinTech Futures,
// Bank Automation News, Credit Union Times, Financial Advisor Magazine,
// Advisor Perspectives, ThinkAdvisor and NFIB (see rss-sources.json), all of
// which return exactly this shape. Distinguishing "got HTML" from "got zero
// items" matters: the first is a fetch failure worth quarantining over, the
// second may just be a quiet week.
function looksLikeFeed(text) {
  const head = (text || '').slice(0, 600);
  return /<rss[\s>]|<feed[\s>]|<rdf:RDF[\s>]/i.test(head);
}

function firstMatch(block, re) {
  const m = re.exec(block);
  return m ? m[1] : '';
}

// American Banker (and several other WordPress/Arizent feeds) wrap the title
// itself in CDATA, not just the description — strip it before decoding
// entities or "<![CDATA[ Ask an Advisor... ]]>" becomes the literal headline.
function unwrapCdata(s) {
  const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s || '');
  return m ? m[1] : s;
}

// Handles both RSS 2.0 (<item>, <pubDate>, <description>) and Atom (<entry>,
// <updated>/<published>, <content>) with one pass, because the registry now
// mixes both — American Banker and FDIC are RSS 2.0, InvestmentNews and every
// Reddit multireddit are Atom, and Google News is RSS 2.0. Regex rather than
// an XML node for the same reason normalize-reddit-item.js parses Reddit
// itself: one parser shape shared by every branch is easier to reason about
// than an XML node's output shape plus per-branch quirks, and it avoids a
// dependency the sandbox may not expose consistently.
function parseFeedEntries(xml) {
  const isAtom = /<feed[\s>]/i.test((xml || '').slice(0, 600));
  const tag = isAtom ? 'entry' : 'item';
  const out = [];
  for (const chunk of (xml || '').split('<' + tag).slice(1)) {
    const close = '</' + tag + '>';
    const block = chunk.includes(close) ? chunk.split(close)[0] : chunk;

    const title = decodeEntities(
      unwrapCdata(firstMatch(block, /<title[^>]*>([\s\S]*?)<\/title>/i))
    ).trim();

    let link = '';
    if (isAtom) {
      // Prefer rel="alternate" (or an unmarked rel, which defaults to
      // alternate) over rel="self"/"via", which point at the feed or the
      // aggregator rather than the article.
      const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
      const alt = links.find((attrs) => !/rel="(self|via)"/i.test(attrs)) || links[0] || '';
      link = decodeEntities(firstMatch('<link' + alt, /href="([^"]+)"/i));
    } else {
      link = decodeEntities(
        unwrapCdata(firstMatch(block, /<link[^>]*>([\s\S]*?)<\/link>/i))
      ).trim();
    }

    const guid = decodeEntities(unwrapCdata(firstMatch(block, /<guid[^>]*>([\s\S]*?)<\/guid>/i))) ||
      decodeEntities(unwrapCdata(firstMatch(block, /<id>([\s\S]*?)<\/id>/i))) || link;

    const published =
      firstMatch(block, /<pubDate>([\s\S]*?)<\/pubDate>/i) ||
      firstMatch(block, /<updated>([\s\S]*?)<\/updated>/i) ||
      firstMatch(block, /<published>([\s\S]*?)<\/published>/i) ||
      firstMatch(block, /<dc:date>([\s\S]*?)<\/dc:date>/i);

    let content = decodeEntities(
      firstMatch(block, /<content:encoded>([\s\S]*?)<\/content:encoded>/i) ||
      firstMatch(block, /<description>([\s\S]*?)<\/description>/i) ||
      firstMatch(block, /<content[^>]*>([\s\S]*?)<\/content>/i) ||
      firstMatch(block, /<summary[^>]*>([\s\S]*?)<\/summary>/i)
    );
    content = content.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ');
    content = content.replace(/\s+/g, ' ').trim();

    if (!title || !link) continue;
    out.push({ title, link, guid: guid || link, published, content });
  }
  return out;
}

// new URL() is not available in the n8n Code node sandbox — it throws, and a
// try/catch around it yields a silent empty host. That is what made every AI
// Research item fall through to the bare 'AI Research' label.
function hostOf(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url || '');
  return m ? m[1].replace(/^www\./i, '').toLowerCase() : '';
}

// Google News gives every item a news.google.com link, so the only place the
// real publisher appears is the trailing " - Publisher" on the title.
// compute-canonical-url.js strips the same suffix before hashing titles.
// Splitting on ' - ' rather than a bare hyphen keeps hyphenated publishers
// ("ad-hoc-news.de") and hyphenated headlines ("digital-centric") intact.
function publisherFromTitle(title) {
  const parts = (title || '').trim().split(' - ');
  if (parts.length < 2) return '';
  const last = parts[parts.length - 1].trim();
  return last.length >= 2 && last.length <= 60 ? last : '';
}

// The headline with the publisher suffix removed. Entity matching has to run
// against this, not the raw title: "Ukrainians become target of Poland's
// populist rhetoric - RBC-Ukraine" matched the alias "RBC" only inside the
// publisher's name, and every Ukraine war story became Royal Bank of Canada
// customer news.
function headlineOf(title) {
  const publisher = publisherFromTitle(title);
  const raw = (title || '').trim();
  return publisher ? raw.slice(0, raw.length - publisher.length).replace(/\s+-\s*$/, '') : raw;
}

// What entity and LOB matching should run against: the headline plus the body
// with the outlet's own name removed. Google News repeats the publisher inside
// contentSnippet, so stripping it from the title alone would still leave
// "RBC-Ukraine" in the body for the alias "RBC" to match.
function matchTextOf(a) {
  const publisher = publisherFromTitle(a.title);
  const body = (a.contentSnippet || a.content || '').toString();
  return headlineOf(a.title) + ' ' + (publisher ? body.split(publisher).join(' ') : body);
}

// Matched with word boundaries, tolerating a trailing plural. Deliberately
// narrow: a wrong hint routes an item to the wrong section owner, which is
// worse than no hint at all. An item that matches nothing here is usually
// noise, which makes an empty result a useful signal in its own right.
const LOB_KEYWORDS = {
  wealth: [
    'wealth', 'wealth management', 'private bank', 'private banking',
    'advisor', 'adviser', 'advisory', 'ria', 'aum', 'portfolio', 'brokerage',
    'broker-dealer', 'custodian', 'asset management', 'model portfolio',
    'financial planning', 'booking centre', 'booking center'
  ],
  sme_commercial: [
    'sme', 'small business', 'business banking', 'commercial banking',
    'corporate banking', 'treasury', 'cash management', 'working capital',
    'invoice', 'invoicing', 'payroll', 'merchant', 'embedded finance',
    'business lending', 'open banking', 'instant payments', 'core banking',
    // Added Sept 2026 to close the "no SME/commercial news" gap — 2026-era
    // commercial/SME fintech vocabulary the original list missed entirely.
    'kyb', 'know your business', 'embedded lending', 'revenue-based financing',
    'supply chain finance', 'sme lending', 'business current account',
    'sme neobank', 'business onboarding', 'point of sale lending',
    // Jarno feedback (SME/Commercial), 2026-09-24. 'treasury' above already
    // catches "treasury management" as a substring match, and 'open banking'
    // was already in the list — both kept as-is rather than duplicated. Bare
    // 'fdx' deliberately excluded: it's also FedEx's stock ticker, and
    // ANALYST_NOISE_RE/BLOCKED_PUBLISHERS exist precisely to keep that kind
    // of ticker syndication out — the fuller phrases below get the real
    // signal without the collision.
    // 'relationship manager' is fairly generic — wealth advisors and mortgage
    // staff get called that too, so expect a bit more cross-section noise
    // from this one than the others. Kept in as fed back; narrow to
    // commercial relationship manager later if it proves noisy.
    'liquidity management', 'virtual account management',
    'treasury management', 'relationship manager', 'treasury management officer',
    'invoice finance', 'open finance', 'psd3', 'financial data exchange', 'fdx api'
  ],
  retail: [
    'retail bank', 'retail banking', 'consumer bank', 'consumer banking',
    'mobile banking', 'mobile app', 'banking app', 'account opening',
    'onboarding', 'deposit', 'savings account', 'checking account',
    'current account', 'debit card', 'credit card', 'payment', 'overdraft',
    'neobank', 'branch', 'mortgage', 'loan rate', 'lending rate', 'mclr',
    'open banking', 'instant payments', 'core banking'
  ],
  digital_assist: [
    'contact centre', 'contact center', 'call centre', 'call center',
    'customer service', 'agent desktop', 'service desk', 'help desk',
    'chatbot', 'workforce management', 'wfm', 'employee experience',
    'back office', 'bpo', 'cx', 'agent assist', 'agentic', 'agentforce',
    'unified frontline', 'teller', 'case management', 'omnichannel',
    'quality assurance', 'csat'
  ]
};

// Substring match on the publisher, so "MarketBeat" and "MarketBeat.com" both
// hit. These are the market-data / analyst-note aggregators that syndicate a
// templated item per bank per day — measured across the customer and
// competitor branches, they never once produced a story worth citing, only
// stock-move and rating-change noise that crowded the curator's pool cap.
// Shared because the same outlets pollute both branches identically.
const BLOCKED_PUBLISHERS = [
  'marketbeat', 'marketscreener', 'simplywall', 'tipranks', 'gurufocus',
  'moomoo', 'tradingview', 'stock titan', 'stocktitan', 'investing.com',
  'kalkine', 'benzinga', 'seeking alpha', 'zacks', 'insider monkey',
  'defense world', 'defenseworld', 'etf daily news', 'americanbankingnews',
  'barchart', 'quiver quantitative', 'fintel', 'holdings channel',
  'wallstreetzen', 'stocksregister', 'financhill', 'indexbox', 'bloomingbit',
  'biggo', 'pluang', 'devdiscourse', 'sharewise', 'stocknews',
  'yahoo finance', 'marketwatch', 'fxstreet', 'ad hoc news', 'adhoc news',
  'ndtv profit', 'tikr', 'proactive investors'
];

function isBlockedPublisher(publisher) {
  const p = (publisher || '').toLowerCase();
  return BLOCKED_PUBLISHERS.some((b) => p.includes(b));
}

// Title-shaped noise that survives a "does this mention banking" check but is
// never the kind of story the newsletter cites: a bank's name is the subject
// of an analyst note, a price move, or a routine earnings recap rather than
// the subject of actual news. Measured on a real pool: analyst/rating,
// stock-move and litigation titles together were ~10% of the customer branch
// and effectively 0% of what the curator ever kept. Shared with the
// competitor branch, which gets the identical syndication from the identical
// aggregators.
// Keyword proxies for the six qualitative "relevance lenses" documented in
// ai-research-sources.json (agentic_ai_banking, ai_governance_compliance,
// foundation_model_capability, agent_interoperability_standards,
// competitor_ai_feature, ai_regulation_financial_services). A keyword match
// is not the same thing as the LLM judgment those lenses actually describe —
// this exists only to gate the general_ai_rss feeds (mainstream tech press:
// MIT Technology Review, VentureBeat, The Verge, Ars Technica), which are
// "AI news in general" by design and will drift into exactly that without a
// pre-curation filter. Google News queries built from the registry's
// targeted_google_news_queries are on-thesis by construction and skip this
// gate entirely — see load-ai-research-sources.js's 'origin' field.
const AI_LENS_KEYWORDS = [
  'agentic', 'agent', 'autonomous ai', 'ai native', 'banking os',
  'governance', 'explainability', 'guardrail', 'audit', 'model risk',
  'gpt', 'claude', 'gemini', 'llama', 'mistral', 'anthropic', 'openai',
  'deepmind', 'tool use', 'function calling', 'context window', 'reasoning model',
  'model context protocol', 'agent2agent', 'a2a protocol', 'interoperability',
  'eu ai act', 'ai regulation', 'ai act', 'occ', 'federal reserve', 'fca',
  'financial services', 'bank', 'banking', 'fintech'
];

function looksAiRelevant(text) {
  const haystack = (text || '').toLowerCase();
  return AI_LENS_KEYWORDS.some((k) => haystack.includes(k));
}

const ANALYST_NOISE_RE = new RegExp(
  '\\b(' +
    'price target|upgrades? to|downgrades? to|initiates? coverage|' +
    'analyst rating|rating (upgrade|downgrade)|buy rating|sell rating|hold rating|' +
    'outperform|underperform|overweight|underweight|' +
    'shares? (rise|rose|fall|fell|climb|drop|surge|plunge|jump|slide)|' +
    'stock (rises?|falls?|climbs?|drops?|surges?|plunges?|jumps?|slides?)|' +
    '13f filing|institutional investors?|hedge fund.*(buys|sells|trims|boosts) (stake|shares|position)|' +
    'class action|lead plaintiff|securities fraud|shareholder (lawsuit|alert)|investor alert' +
  ')\\b',
  'i'
);

function inferLobTags(text) {
  const haystack = (text || '').toLowerCase();
  return Object.keys(LOB_KEYWORDS)
    .map((lob) => ({
      lob,
      score: LOB_KEYWORDS[lob].filter((k) =>
        new RegExp('\\b' + escapeRe(k) + '(s|es)?\\b').test(haystack)
      ).length
    }))
    .filter((r) => r.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, 2)
    .map((r) => r.lob);
}

// Three tags is the ceiling: the curator may file an item in at most two
// sections, so more than that is noise dressed as signal.
function mergeTags(primary, secondary) {
  return (primary || [])
    .concat(secondary || [])
    .filter((t, i, all) => t && all.indexOf(t) === i)
    .slice(0, 3);
}
//     file is not runnable as-is. To patch this node by hand, paste the output of
//     `node newsletter/n8n/build-workflow.mjs --node "Normalize Reddit Item"`, not this file.

const REDDIT_REGISTRY = {"_comment":"Tier 2 — Reddit source registry, tightened from the ~30-subreddit v2 list based on signal-to-noise. Read by the 'Load Reddit Sources' Code node.","access_method":"Public Reddit RSS, fetched as ONE request per subreddit (https://www.reddit.com/r/{name}/top/.rss?t=week&limit=20) by n8n's NATIVE 'Reddit Fetch' (RSS Feed Read) node, wrapped in a 'Reddit Loop' (Loop Over Items, batch size 1) + 'Reddit Wait' pair so the 16 requests go out one at a time instead of in a burst, before 'Normalize Reddit Item' does the cross-subreddit balancing on the loop's done output. Nothing re-tags the entries in between: they already carry their subreddit in their /r/<sub>/ permalink (see response_shape). Deliberately NOT using Reddit's OAuth Data API / native n8n Reddit node: Reddit closed self-service app creation in Nov 2025 (Responsible Builder Policy, manual pre-approval required for new apps), and the public RSS surface covers this read-only, low-volume, once-a-week use case without needing an app at all.","access_method_history":"v1: 16 requests, one per subreddit, against /new/.rss via an 'RSS Feed Read' node with n8n's default User-Agent and no spacing. Reddit answered the first and returned HTTP 429 for the other 15 every single run, so the branch silently reduced to r/banking. v2 (mis-diagnosis): read that as 'too many requests' and combined all 16 subreddits into ONE multireddit URL (plus a second multireddit for the subset that couldn't win a global ranking), switched to /top/?t=week, and added a real User-Agent + batch spacing on an HTTP Request node — two independent fixes bundled into one change. That held for a while, then the *second* (6-subreddit 'reserved fill') multireddit URL started coming back HTTP 403 with a WAF interstitial ('You've been blocked by network security'), not a 429 — and tripling the spacing (30s to 90s) made zero difference. v3 (still HTTP Request node): un-combined the URLs back to one request per subreddit, on the theory that request SHAPE (a combined r/a+b+c+... URL nothing else on the internet sends) was the trigger, not request count. Still used the same custom User-Agent as v2 (\"BackbaseInsights/1.0 ... ingestion\"). v4 (current): switched the fetch itself from an HTTP Request node to n8n's NATIVE 'RSS Feed Read' node. Reason: n8n's HTTP Request node with no User-Agent set sends a bare 'n8n' string, which n8n's own issue tracker documents as a common WAF-403 trigger for OTHER integrations (WooCommerce, WordPress, GitHub) — the fix there was a real User-Agent, same as v2/v3 did here. But 'BackbaseInsights/1.0 (n8n newsletter ingestion; +https://backbase.com)' is itself a bespoke string that explicitly self-identifies as bot/ingestion traffic, which is exactly the shape a WAF fingerprints, whereas the native RSS Feed Read node hardcodes `User-Agent: rss-parser` plus real RSS/Atom Accept headers — 'rss-parser' is one of the most common UAs on the internet for this exact traffic pattern (it's what countless small feed-reading scripts send) and is far less likely to be treated as suspicious than a one-off custom string. This is the first fetch-shape change made for a load-bearing reason OTHER than URL combining — if request 1 (r/banking, historically reliable under every prior version) still fails under v4, that is strong evidence the User-Agent was never the fix either, and something else (IP reputation from repeated testing, TLS fingerprint) is at play.","request_plan":"One request per entry in 'subreddits' below, in list order — 'Load Reddit Sources' builds the request list directly from this array (via @data), so there is exactly one registry to keep in sync. See _subreddits_comment. 'Reddit Loop' (Loop Over Items, batch size 1) feeds the fetch one subreddit at a time and 'Reddit Wait' enforces spacing before looping back. The spacing is the load-bearing part, MEASURED TWICE: a plain RSS Feed Read node handed all 16 URLs at once answers the first and fails the other 15, under both v1 (2025) and v4 (Sept 2026) — that node has no batching/interval option of its own the way the HTTP Request node does, so without the loop there is nothing to slow the burst down.","response_shape":"n8n's RSS Feed Read node emits rss-parser's own shape, measured against a live Reddit feed: { title, link, pubDate, author, content, contentSnippet, id, isoDate }. Three details the normalizer depends on: (1) the entry id arrives as `id` ('t3_1w4pf8f'), NOT `guid` — that is the dedupe key; (2) `contentSnippet` is the HTML-stripped body and ends with a 'submitted by    /u/name  [link]   [comments]' trailer whose shape is 'submitted by /u/name' with NO 'to r/sub' half (an earlier strip regex required that half and therefore silently stripped nothing); (3) there is no subreddit field at all — normalize-reddit-item.js recovers it from the /r/<sub>/ segment of `link` instead, which is why no tagging node sits between the fetch and the normalizer. A subreddit that returned nothing (empty feed OR failed fetch, indistinguishable) arrives as a bare {}.","selection_rule":"Reddit's RSS never exposes a score, and a single-subreddit /top/ feed only ranks within that one subreddit — there is no way to recompute a genuine cross-subreddit ranking client-side (that is what the old multireddit 'spine' bought, and it is the one thing this design gives up). Normalize Reddit Item instead: (1) caps any single subreddit's contribution at PER_SUB_CAP so a high-volume subreddit (FinancialCareers, smallbusiness) cannot crowd out the rest — measured cause of the old registry's 44-of-100-entries problem before that cap existed; (2) fills the pool round-robin across subreddits in priority order (high before medium before low, registry order within a tier) up to REDDIT_CAP or until every subreddit is exhausted, so representation across the roster is guaranteed rather than left to chance. This trades 'the single most-engaged post anywhere on Reddit this week' for guaranteed presence of every on-thesis subreddit — the latter is what the coverage gate's reddit_subreddits >= 8 floor actually needs, and what the old design's own comments admitted the pure-global version could not deliver (10 of 16 subreddits reached on a measured week).","_subreddits_comment":"This list IS the request list now (one Reddit Fetch request per entry, in order) — not just an editorial label read by a separate 'requests' array. 'priority' drives round-robin order in Normalize Reddit Item (high tier exhausted its round before medium, etc.); keep it accurate. Read by the 'Load Reddit Sources' Code node via @data.","subreddits":[{"name":"banking","cohort":"industry","category":"Employee","focus":"mixed","priority":"high"},{"name":"FinancialCareers","cohort":"employee","category":"Employee","focus":"employee","priority":"high","notes":"By far the highest-volume subreddit in this list — used to take 44 of 100 pool slots when it shared a multireddit with everything else. PER_SUB_CAP now bounds it the same as every other subreddit, so it no longer needs to be excluded or specially handled."},{"name":"callcentres","cohort":"employee","category":"Employee","focus":"employee","priority":"high","notes":"FIX: this registry said 'callcenter', which is not a subreddit that exists. It returned zero entries for the life of the workflow, and because the branch was also being rate-limited nobody could distinguish 'throttled' from 'does not exist'. r/callcentres (British spelling) is the real one — 36 posts in a single top-week pull."},{"name":"CustomerService","cohort":"employee","category":"Employee","focus":"employee","priority":"medium"},{"name":"talesfromcallcenters","cohort":"employee","category":"Employee","focus":"employee","priority":"medium","notes":"Genuinely low volume — 3 posts in an 18-day window when measured. Kept because it is on-thesis, but it is the one subreddit of 16 that regularly contributes nothing, and that is the subreddit's own activity level rather than a fetch problem."},{"name":"personalfinance","cohort":"consumer","category":"Customer","focus":"banking","priority":"high"},{"name":"CreditCards","cohort":"consumer","category":"Customer","focus":"banking","priority":"high"},{"name":"CreditUnions","cohort":"consumer","category":"Customer","focus":"banking","priority":"high"},{"name":"fintech","cohort":"industry","category":"Technology","focus":"banking","priority":"high"},{"name":"povertyfinance","cohort":"consumer","category":"Customer","focus":"banking","priority":"medium"},{"name":"Mortgages","cohort":"consumer","category":"Customer","focus":"banking","priority":"medium"},{"name":"smallbusiness","cohort":"regional_sme","category":"Customer","focus":"banking","priority":"medium","lob_hint":"sme_commercial","notes":"Very high volume (~85 posts/day observed); PER_SUB_CAP matters most here and on FinancialCareers. lob_hint added 2026-09-24 so this subreddit is deliberately routed to SME/Commercial instead of relying solely on keyword inference — see normalize-reddit-item.js. Don't copy lob_hint onto UKPersonalFinance/Scams/PersonalFinanceCanada/AusFinance just because they share the 'regional_sme' cohort label — cohort groups regional consumer-finance subs generically and was never SME-specific; only this one actually is."},{"name":"UKPersonalFinance","cohort":"regional_sme","category":"Customer","focus":"banking","priority":"medium"},{"name":"Scams","cohort":"regional_sme","category":"Customer","focus":"banking","priority":"medium"},{"name":"PersonalFinanceCanada","cohort":"regional_sme","category":"Customer","focus":"banking","priority":"low"},{"name":"AusFinance","cohort":"regional_sme","category":"Customer","focus":"banking","priority":"low"}],"removed_from_v2":[{"name":"antiwork","reason":"High noise, low banking-product signal — general labour grievance, not actionable for Digital Assist."},{"name":"WorkReform","reason":"Same as antiwork."},{"name":"jobs","reason":"Not banking-specific; dilutes employee signal with unrelated career posts."},{"name":"CryptoCurrency","reason":"Off-thesis for a retail/SME/wealth/Digital Assist newsletter; crypto-native audience overlaps poorly with target LOBs."},{"name":"TalesFromRetail","reason":"General retail, not banking-specific; low hit rate on relevant posts in practice."},{"name":"StudentLoans / CreditRepair / DebtFree / financialindependence / entrepreneur / Accounting / EuropeFIRE / legaladvice","reason":"Each individually low-volume for banking-employee/product signal; folding budget into the higher-priority list above rather than spreading thin across 30 subreddits."}],"collection_params":{"listing":"top","time_filter":"week","limit_per_request":20,"requests_per_run":16,"batch_interval_ms":20000,"retries":2,"window_days":7,"reddit_cap":100,"per_sub_cap":12,"min_selftext_length":40,"dedupe_key":"reddit_post_id","notes":"listing went hot -> new -> top. 'new' gave whatever happened to be posted most recently, which on a weekly poll is dominated by the highest-volume subreddit in the feed; 'top' with t=week ranks by what that subreddit's community actually engaged with and is scoped to the edition window server-side. The client-side window_days check is kept as a guard so a URL that loses t=week cannot quietly widen the edition. limit_per_request dropped 25 -> 20 (v4): still comfortably above per_sub_cap=12 after filtering; lower purely because a smaller per-request payload is one more thing that reads as an ordinary feed reader rather than a bulk scrape, on top of the v4 User-Agent change (see access_method_history) — unverified whether it matters, cheap to keep low regardless. batch_interval_ms is now enforced by the 'Reddit Wait' node between Loop Over Items iterations, not by an HTTP node's batching option (see access_method). retries dropped 3 -> 2 (v4): the native RSS Feed Read node's retry is the generic n8n retryOnFail, not the HTTP Request node's own batching-aware retry, and a failed subreddit no longer blocks the other 15 (onError: continueRegularOutput sends it back round the loop like any other outcome) so there is less to gain from a third attempt. reddit_cap and per_sub_cap together bound Reddit's share of the pool and any one subreddit's share of that — see selection_rule for how they combine. min_selftext_length is measured after stripping Reddit's 'submitted by /u/x [link] [comments]' trailer (see response_shape for the exact shape, which is NOT the 'to r/y' form this note used to claim), so it still filters out link-only posts with no discussion body."}};

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
