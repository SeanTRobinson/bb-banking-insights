// Node: "Normalize RSS Item" (Code, Run Once for All Items)
// Input:  RSS Fetch  (raw feed/Atom text, one response per Load RSS Sources item)
// Output: pool items carrying a publication name and LOB routing hints, plus
//         one _fetch_event marker per source for the coverage report
//
// Three things used to strip this branch of everything the curator needs:
//
//   source_name came from a.creator, which is the byline rather than the
//   outlet. Banking Dive arrived as "Dan Ennis" and Call Centre Helper as
//   "Guest Author". The curator is told to prefer named trade publications, so
//   it read its best-sourced feed as anonymous blogging and kept 1 of 73.
//
//   lob_tags was [], so wealth / retail / sme_commercial had no routing signal
//   and all three came back empty in the first real edition.
//
//   No per-source cap, so Wealth Management Magazine alone could and did
//   contribute 41 of 73 RSS items in one measured pool — one feed defining
//   the branch's entire LOB mix.
//
// Source identity now comes from $('Load RSS Sources').itemMatching(i), not
// host-guessing: rss-sources.json's own audit found feeds whose article links
// resolve to a different host than the feed itself (FDIC's govdelivery feed
// links to content.govdelivery.com), which host-matching could never have
// attributed correctly.

// @include shared/pool-helpers.js   <- resolved by build-workflow.mjs; this
//     file is not runnable as-is. To patch this node by hand, paste the output of
//     `node newsletter/n8n/build-workflow.mjs --node "Normalize RSS Item"`, not this file.

const out = [];

for (let i = 0; i < $input.all().length; i++) {
  const item = $input.all()[i];
  const source = $('Load RSS Sources').itemMatching(i).json;
  const windowMs = (source.window_days || 7) * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - windowMs;
  const raw = bodyOf(item.json);

  function fetchEvent(status, extra) {
    return {
      json: Object.assign(
        { _fetch_event: true, source_type: 'rss', source_key: source.source_key, url: source.url, status },
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
    if (kept >= (source.cap || 12)) break;
    const d = new Date(a.published || 0).getTime();
    if (!d || d < cutoff) continue;

    const matchText = headlineOf(a.title) + ' ' + a.content;
    kept++;
    out.push({
      json: {
        source_type: 'rss',
        source_key: source.source_key,
        source_name: source.source_name,
        title: a.title,
        link: a.link,
        published_date: a.published || '',
        content: a.content,
        lob_tags: mergeTags(inferLobTags(matchText), source.lob_tags),
        is_customer_news: false,
        is_competitive: false,
        competitor_name: '',
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
