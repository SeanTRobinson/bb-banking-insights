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

// @include shared/pool-helpers.js   <- resolved by build-workflow.mjs; this
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
