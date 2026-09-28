import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNode, rss2, json, loadPoolHelpers } from './harness.mjs';

const { isBlockedPublisher, looksAiRelevant, ANALYST_NOISE_RE } = loadPoolHelpers();

// ---- shared/pool-helpers.js filter primitives ------------------------

test('isBlockedPublisher matches known market-data aggregators, case- and suffix-insensitively', () => {
  assert.equal(isBlockedPublisher('MarketBeat'), true);
  assert.equal(isBlockedPublisher('MarketBeat.com'), true);
  assert.equal(isBlockedPublisher('marketbeat'), true);
  assert.equal(isBlockedPublisher('Reuters'), false);
  assert.equal(isBlockedPublisher(''), false);
});

test('ANALYST_NOISE_RE matches analyst/13F/litigation title-noise, not ordinary banking headlines', () => {
  assert.equal(ANALYST_NOISE_RE.test('Bank of Example price target raised to $50'), true);
  assert.equal(ANALYST_NOISE_RE.test('Hedge fund boosts stake in Bank of Example'), true);
  assert.equal(ANALYST_NOISE_RE.test('Shareholder lawsuit filed against Bank of Example'), true);
  assert.equal(ANALYST_NOISE_RE.test('Bank of Example launches new mobile banking app'), false);
});

test('looksAiRelevant gates general tech-press feeds on at least one relevance-lens keyword', () => {
  assert.equal(looksAiRelevant('Anthropic ships a new agentic tool-use feature for banks'), true);
  assert.equal(looksAiRelevant('EU AI Act financial services guidance published'), true);
  assert.equal(looksAiRelevant('Apple unveils new iPhone camera'), false);
});

// ---- normalize-customer-item.js ---------------------------------------

function customerSource(name, alias) {
  return json({ source_key: 'customer:' + name, source_type: 'customer', source_name: name, name, aliases: [alias || name] });
}

test('normalize-customer-item.js caps a chatty bank query at PER_CUSTOMER_CAP (12)', () => {
  const bank = customerSource('Test Bank');
  const items = [];
  for (let i = 0; i < 20; i++) {
    items.push({
      title: `Test Bank launches new digital banking feature number ${i} - Trade Press`,
      link: `https://example.com/${i}`,
      pubDate: 'Mon, 07 Sep 2026 12:00:00 GMT',
      description: 'Test Bank rolled out a new mobile banking app feature this week for customers.'
    });
  }
  const feed = rss2({ items });
  const out = runNode('normalize-customer-item.js', [json({ data: feed })], { 'Load Customer Banks (Tier A)': [bank] });
  const articles = out.filter((i) => !i.json._fetch_event);
  assert.equal(articles.length, 12, 'expected exactly PER_CUSTOMER_CAP=12 articles, got ' + articles.length);
});

test('normalize-customer-item.js drops market-data aggregator syndication', () => {
  const bank = customerSource('Test Bank');
  const feed = rss2({
    items: [
      {
        title: 'Test Bank (TSTB) shares outlook - MarketBeat',
        link: 'https://marketbeat.com/a',
        pubDate: 'Mon, 07 Sep 2026 12:00:00 GMT',
        description: 'Test Bank stock coverage.'
      }
    ]
  });
  const out = runNode('normalize-customer-item.js', [json({ data: feed })], { 'Load Customer Banks (Tier A)': [bank] });
  const articles = out.filter((i) => !i.json._fetch_event);
  assert.equal(articles.length, 0, 'MarketBeat item should have been dropped');
});

test('normalize-customer-item.js drops analyst-rating/price-target noise even from a non-blocked publisher', () => {
  const bank = customerSource('Test Bank');
  const feed = rss2({
    items: [
      {
        title: 'Test Bank price target raised to $50 - Reuters',
        link: 'https://reuters.com/a',
        pubDate: 'Mon, 07 Sep 2026 12:00:00 GMT',
        description: 'Analyst note on Test Bank.'
      }
    ]
  });
  const out = runNode('normalize-customer-item.js', [json({ data: feed })], { 'Load Customer Banks (Tier A)': [bank] });
  const articles = out.filter((i) => !i.json._fetch_event);
  assert.equal(articles.length, 0, 'analyst price-target note should have been dropped');
});

test('normalize-customer-item.js does not match an alias that only appears inside the publisher suffix', () => {
  // Regression case documented in the file header: "Ukrainians become
  // target of Poland's populist rhetoric - RBC-Ukraine" must not become
  // Royal Bank of Canada customer news just because "RBC" is in the outlet name.
  const bank = customerSource('Royal Bank of Canada', 'RBC');
  const feed = rss2({
    items: [
      {
        title: "Ukrainians become target of Poland's populist rhetoric - RBC-Ukraine",
        link: 'https://rbc-ukraine.example/a',
        pubDate: 'Mon, 07 Sep 2026 12:00:00 GMT',
        description: 'War coverage with no mention of the bank.'
      }
    ]
  });
  const out = runNode('normalize-customer-item.js', [json({ data: feed })], { 'Load Customer Banks (Tier A)': [bank] });
  const articles = out.filter((i) => !i.json._fetch_event);
  assert.equal(articles.length, 0, 'alias match inside the publisher suffix alone must not count');
});

test('normalize-customer-item.js drops sponsorship/same-name collisions (NOT_THE_BANK)', () => {
  const bank = customerSource('Citizens', 'Citizens Bank');
  const feed = rss2({
    items: [
      {
        title: 'Concert announced at Citizens Bank Park this summer',
        link: 'https://example.com/park',
        pubDate: 'Mon, 07 Sep 2026 12:00:00 GMT',
        description: 'Citizens Bank Park is hosting a concert series.'
      }
    ]
  });
  const out = runNode('normalize-customer-item.js', [json({ data: feed })], { 'Load Customer Banks (Tier A)': [bank] });
  const articles = out.filter((i) => !i.json._fetch_event);
  assert.equal(articles.length, 0, 'Citizens Bank Park must not be attributed to the bank');
});

test('normalize-customer-item.js emits an error fetch_event for a Cloudflare challenge page, not a silent empty', () => {
  const bank = customerSource('Test Bank');
  const out = runNode(
    'normalize-customer-item.js',
    [json({ data: '<html><title>Just a moment...</title><div class="cf-browser-verification"></div></html>' })],
    { 'Load Customer Banks (Tier A)': [bank] }
  );
  const events = out.filter((i) => i.json._fetch_event);
  assert.equal(events.length, 1);
  assert.equal(events[0].json.status, 'error');
});

// ---- normalize-competitor-item.js --------------------------------------

function competitorSource(name, alias) {
  return json({ source_key: 'competitor:' + name, source_type: 'competitor', source_name: name, name, aliases: [alias || name], lob_tags: ['cross_cutting'] });
}

test('normalize-competitor-item.js drops items where no tracked vendor alias actually appears', () => {
  const vendor = competitorSource('Temenos');
  const feed = rss2({
    items: [
      {
        title: 'A general fintech roundup mentioning nothing in particular',
        link: 'https://example.com/roundup',
        pubDate: 'Mon, 07 Sep 2026 12:00:00 GMT',
        description: 'No vendor name appears anywhere in this text at all.'
      }
    ]
  });
  const out = runNode('normalize-competitor-item.js', [json({ data: feed })], { 'Load Competitor Watchlist': [vendor] });
  const articles = out.filter((i) => !i.json._fetch_event);
  assert.equal(articles.length, 0, 'unmatched competitor item must be dropped, not shipped untagged');
});

test('normalize-competitor-item.js keeps an item that actually names the vendor and tags competitor_name', () => {
  const vendor = competitorSource('Temenos');
  const feed = rss2({
    items: [
      {
        title: 'Temenos launches new agentic banking feature',
        link: 'https://example.com/temenos',
        pubDate: 'Mon, 07 Sep 2026 12:00:00 GMT',
        description: 'Temenos announced a new core banking capability this week.'
      }
    ]
  });
  const out = runNode('normalize-competitor-item.js', [json({ data: feed })], { 'Load Competitor Watchlist': [vendor] });
  const articles = out.filter((i) => !i.json._fetch_event);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].json.competitor_name, 'Temenos');
  assert.equal(articles[0].json.is_competitive, true);
});

test('normalize-competitor-item.js drops market-data aggregator syndication on public-company vendors', () => {
  const vendor = competitorSource('Fiserv');
  const feed = rss2({
    items: [
      {
        title: 'Fiserv (FISV) shares outlook - MarketBeat',
        link: 'https://marketbeat.com/fiserv',
        pubDate: 'Mon, 07 Sep 2026 12:00:00 GMT',
        description: 'Fiserv stock coverage.'
      }
    ]
  });
  const out = runNode('normalize-competitor-item.js', [json({ data: feed })], { 'Load Competitor Watchlist': [vendor] });
  const articles = out.filter((i) => !i.json._fetch_event);
  assert.equal(articles.length, 0);
});

test('normalize-competitor-item.js drops analyst-note noise on public-company vendors', () => {
  const vendor = competitorSource('Fiserv');
  const feed = rss2({
    items: [
      {
        title: 'Fiserv price target raised to $200 - Reuters',
        link: 'https://reuters.com/fiserv',
        pubDate: 'Mon, 07 Sep 2026 12:00:00 GMT',
        description: 'Analyst note on Fiserv.'
      }
    ]
  });
  const out = runNode('normalize-competitor-item.js', [json({ data: feed })], { 'Load Competitor Watchlist': [vendor] });
  const articles = out.filter((i) => !i.json._fetch_event);
  assert.equal(articles.length, 0, 'analyst price-target note on a vendor should be dropped, same as on a customer bank');
});

test('normalize-competitor-item.js caps a chatty vendor query at PER_VENDOR_CAP (12)', () => {
  const vendor = competitorSource('Temenos');
  const items = [];
  for (let i = 0; i < 20; i++) {
    items.push({
      title: `Temenos ships update number ${i}`,
      link: `https://example.com/${i}`,
      pubDate: 'Mon, 07 Sep 2026 12:00:00 GMT',
      description: 'Temenos platform update.'
    });
  }
  const feed = rss2({ items });
  const out = runNode('normalize-competitor-item.js', [json({ data: feed })], { 'Load Competitor Watchlist': [vendor] });
  const articles = out.filter((i) => !i.json._fetch_event);
  assert.equal(articles.length, 12);
});

// ---- normalize-ai-research-item.js -------------------------------------

test('normalize-ai-research-item.js gates general_ai_rss items through looksAiRelevant, but not targeted queries', () => {
  const generalSource = json({ source_key: 'ai:general-src', source_type: 'ai_research', source_name: 'General AI Press', origin: 'general', cap: 8 });
  const targetedSource = json({ source_key: 'ai:targeted-src', source_type: 'ai_research', source_name: 'Targeted Query', origin: 'targeted', cap: 20 });

  const offThesisFeed = rss2({
    items: [{ title: 'Apple unveils new iPhone camera', link: 'https://example.com/iphone', pubDate: 'Mon, 07 Sep 2026 12:00:00 GMT', description: 'A new camera sensor with improved photo quality and a faster shutter speed.' }]
  });
  const onThesisFeed = rss2({
    items: [{ title: 'General AI news roundup mentions agentic banking assistant', link: 'https://example.com/agentic', pubDate: 'Mon, 07 Sep 2026 12:00:00 GMT', description: 'Agentic AI in banking, tool use and function calling for financial services.' }]
  });

  const generalOut = runNode('normalize-ai-research-item.js', [json({ data: offThesisFeed })], { 'Load AI Research Sources': [generalSource] });
  assert.equal(generalOut.filter((i) => !i.json._fetch_event).length, 0, 'off-thesis general_ai_rss item must be gated out');

  const generalOnThesisOut = runNode('normalize-ai-research-item.js', [json({ data: onThesisFeed })], { 'Load AI Research Sources': [generalSource] });
  assert.equal(generalOnThesisOut.filter((i) => !i.json._fetch_event).length, 1, 'on-thesis general_ai_rss item must pass the gate');

  // A targeted query returning the SAME off-thesis-looking headline (e.g. a
  // company-name query returning an unrelated hit) is not gated at all —
  // it is on-thesis by construction, per the file's own header comment.
  const targetedOut = runNode('normalize-ai-research-item.js', [json({ data: offThesisFeed })], { 'Load AI Research Sources': [targetedSource] });
  assert.equal(targetedOut.filter((i) => !i.json._fetch_event).length, 1, 'targeted queries must skip the relevance-lens gate');
});
