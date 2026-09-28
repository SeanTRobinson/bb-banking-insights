// Node: "Normalize AI Research Item" (Code, Run Once for All Items)
// Input:  AI Research Fetch  (raw feed/RSS text, one response per source)
// Output: pool items for AI Research Radar, cross-tagged by banking LOB, plus
//         one _fetch_event marker per source for the coverage report
//
// sourceFor() used to call new URL(), which throws in the Code node sandbox.
// Its try/catch swallowed the throw, host came back empty, and every single
// item — Ars Technica, Reuters, The Verge, all of Google News — was labelled
// "AI Research". The Google News branch also depended on pairedItem, which
// rssFeedRead never populates, so it could not have worked either.
//
// Publisher now comes from $('Load AI Research Sources').itemMatching(i) for
// direct RSS feeds (the registry already names the outlet) and from the
// title suffix for Google News items (one query surfaces many outlets, so
// the registry's own source_name is a query label, not a publisher).
//
// lob_tags also carries up to two banking hints alongside 'ai_research'. The
// first edition filed Kyndryl's KYC automation and Genesys' agentic
// orchestration under AI Research Radar only, so Digital Assist never saw
// them; the curator may use two sections per item and now has the hint to.
//
// general_ai_rss items now go through looksAiRelevant() (see
// shared/pool-helpers.js) before being kept — that branch is mainstream tech
// press by design, and without a gate "AI Research Radar" drifts into "tech
// news digest." Targeted Google News queries are on-thesis by construction
// (the query itself names the lens) and skip the gate.

// @include shared/pool-helpers.js   <- resolved by build-workflow.mjs; this
//     file is not runnable as-is. To patch this node by hand, paste the output of
//     `node newsletter/n8n/build-workflow.mjs --node "Normalize AI Research Item"`, not this file.

const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
const out = [];

for (let i = 0; i < $input.all().length; i++) {
  const item = $input.all()[i];
  const source = $('Load AI Research Sources').itemMatching(i).json;
  const raw = bodyOf(item.json);

  function fetchEvent(status, extra) {
    return {
      json: Object.assign(
        { _fetch_event: true, source_type: 'ai_research', source_key: source.source_key, url: source.url, status },
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
    if (kept >= (source.cap || 8)) break;
    const d = new Date(a.published || 0).getTime();
    if (!d || d < sevenDaysAgo) continue;

    const isTargeted = source.origin === 'targeted';
    const publisher = isTargeted ? publisherFromTitle(a.title) : '';
    const sourceName = isTargeted ? (publisher || 'Google News') : source.source_name;
    const matchText = headlineOf(a.title) + ' ' + (publisher ? a.content.split(publisher).join(' ') : a.content);

    if (!isTargeted && !looksAiRelevant(matchText)) continue;

    kept++;
    out.push({
      json: {
        source_type: 'ai_research',
        source_key: source.source_key,
        source_name: sourceName,
        title: a.title,
        link: a.link,
        published_date: a.published || '',
        content: a.content,
        lob_tags: mergeTags(['ai_research'], inferLobTags(matchText)),
        is_customer_news: false,
        is_competitive: false,
        competitor_name: '',
        ai_research: true
      }
    });
  }

  out.push(fetchEvent(
    entries.length === 0 ? 'empty' : kept === 0 ? 'filtered_empty' : 'ok',
    { item_count: kept, raw_count: entries.length }
  ));
}

return out;
