// Node: "Normalize Competitor Item" (Code, Run Once for All Items)
// Input:  Competitor Google News  (raw RSS text, one response per vendor query)
// Output: pool items for Competitor Intel, plus one _fetch_event marker per
//         vendor for the coverage report
//
// The two fields that leaned on pairedItem are gone. rssFeedRead does not
// populate it, so parentIndex() returned -1 for every item: surfaced_by was
// always '' and the `queried` LOB fallback never fired, which is why an
// unmatched item like the AIMultiple contact-centre comparison reached the
// curator with no tags at all. Text inference replaces it, and the publisher
// now comes from the Google News title suffix instead of the empty byline.
//
// Two gaps closed in the Sept 2026 audit:
//
//   Unmatched items used to still ship, with is_competitive: false and no
//   vendor name — a story that happens to be loosely related to a vendor's
//   Google News query but never actually names any tracked vendor is not
//   competitor intelligence, it is noise wearing this branch's lob_tags.
//   Dropped outright now, the same standard the customer branch already held.
//
//   Market-data aggregators (MarketBeat, TipRanks, etc.) were never filtered
//   here at all, only on the customer branch — the identical syndicated
//   ownership-filing story about, say, Fiserv's stock got through every time.
//   Now uses the same BLOCKED_PUBLISHERS list from shared/pool-helpers.js.
//
//   Several tracked vendors are public companies (Fiserv, FIS, Q2 Holdings,
//   Alkami, NCR Voyix, SEI). Their analyst-rating/price-target/13F syndication
//   is exactly what ANALYST_NOISE_RE already exists to catch on the customer
//   branch; it was not applied here even though the same noise hits
//   public-company competitors too. Now shared identically.

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
//     `node newsletter/n8n/build-workflow.mjs --node "Normalize Competitor Item"`, not this file.

const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
const vendors = $('Load Competitor Watchlist').all().map((i) => i.json);
const candidates = vendors
  .flatMap((v) => (v.aliases || [v.name]).map((alias) => ({ alias, vendor: v })))
  .sort((x, y) => y.alias.length - x.alias.length);

const PER_VENDOR_CAP = 12;

const out = [];

for (let i = 0; i < $input.all().length; i++) {
  const item = $input.all()[i];
  const source = $('Load Competitor Watchlist').itemMatching(i).json;
  const raw = bodyOf(item.json);

  function fetchEvent(status, extra) {
    return {
      json: Object.assign(
        { _fetch_event: true, source_type: 'competitor', source_key: source.source_key, url: source.url, status },
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
    if (kept >= PER_VENDOR_CAP) break;
    const d = new Date(a.published || 0).getTime();
    if (!d || d < sevenDaysAgo) continue;

    const publisher = publisherFromTitle(a.title);
    if (isBlockedPublisher(publisher)) continue;

    // Publisher name excluded: an alias that appears only in the outlet's own
    // name says nothing about what the story is about.
    const text = headlineOf(a.title) + ' ' + (publisher ? a.content.split(publisher).join(' ') : a.content);
    if (ANALYST_NOISE_RE.test(headlineOf(a.title))) continue;

    // Name the vendor ONLY when one of its aliases actually appears in the
    // item. The Google News queries here are multi-word and unquoted, so
    // they return plenty of loosely-related stories; guessing the vendor from
    // the query that surfaced the item is how every competitor ended up
    // labelled 'Temenos'. An item with no vendor match is dropped, not
    // shipped untagged — see file header.
    let vendor = null;
    for (const c of candidates) {
      if (new RegExp('\\b' + escapeRe(c.alias) + '\\b', 'i').test(text)) {
        vendor = c.vendor;
        break;
      }
    }
    if (!vendor) continue;

    kept++;
    out.push({
      json: {
        source_type: 'competitor',
        source_key: 'competitor:' + vendor.name,
        source_name: publisher || hostOf(a.link) || 'Google News',
        title: a.title,
        link: a.link,
        published_date: a.published || '',
        content: a.content,
        lob_tags: mergeTags(vendor.lob_tags, inferLobTags(text)),
        is_customer_news: false,
        is_competitive: true,
        competitor_name: vendor.name,
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
