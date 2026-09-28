// Reddit's fetch is a Loop Over Items-driven native RSS Feed Read node (see
// build-workflow.mjs's REDDIT_FETCH_NOTES and docs/handoff.md), which means
// "Normalize Reddit Item" consumes rss-parser's OWN output shape rather than
// raw XML or anything this repo attached upstream. Every fixture below is
// modelled on real measured output from that node against Reddit — including
// the two details that broke the first version of this branch: the entry id
// arrives as `id` (not `guid`), and the body trailer reads "submitted by
// /u/name" with no "to r/sub" half.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNode, json, loadRegistry } from './harness.mjs';

const registry = loadRegistry('reddit-sources.json');
const SUBS = registry.subreddits.map((s) => s.name);

const BODY =
  'I just had a seizure recently and woke up in the hospital after someone noticed me on ' +
  'the ground. I was hooked up to an IV and I am very grateful they saved my life.';

// One item exactly as n8n's RSS Feed Read node emits it for a Reddit feed.
function feedItem(sub, { id = 't3_abc123', slug = 'a_post', body = BODY, isoDate = new Date().toISOString(), title = 'A real Reddit post title' } = {}) {
  const link = `https://www.reddit.com/r/${sub}/comments/${id.replace('t3_', '')}/${slug}/`;
  return json({
    title,
    link,
    pubDate: isoDate,
    author: '/u/Historical-Rule-2486',
    content: `<!-- SC_OFF --><div class="md"><p>${body}</p> </div><!-- SC_ON --> &#32; submitted by &#32; <a href="https://www.reddit.com/user/Historical-Rule-2486"> /u/Historical-Rule-2486 </a> <br/> <span><a href="${link}">[link]</a></span> &#32; <span><a href="${link}">[comments]</a></span>`,
    contentSnippet: `${body}\n    submitted by    /u/Historical-Rule-2486  \n [link]   [comments]`,
    id,
    isoDate
  });
}

// The bare {} that alwaysOutputData emits for a subreddit that returned
// nothing (empty feed OR a failed fetch — indistinguishable by design).
const placeholder = () => json({});

function run(items) {
  const out = runNode('normalize-reddit-item.js', items);
  return {
    articles: out.filter((i) => !i.json._fetch_event),
    events: out.filter((i) => i.json._fetch_event)
  };
}

test('identifies each entry\'s subreddit from its /r/<sub>/ permalink, with no upstream tagging', () => {
  const { articles, events } = run([feedItem('povertyfinance'), ...SUBS.slice(1).map(placeholder)]);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].json.source_name, 'r/povertyfinance');
  assert.equal(articles[0].json.source_key, 'reddit:r_povertyfinance');
  assert.equal(articles[0].json.source_type, 'reddit');
  const ok = events.find((e) => e.json.source_key === 'reddit:r_povertyfinance');
  assert.equal(ok.json.status, 'ok');
});

test('matches subreddit case-insensitively but writes the REGISTRY spelling into source_key', () => {
  // Reddit permalinks say /r/Banking/; the registry says 'banking'. source_health
  // rows are keyed on source_key, so the registry spelling has to win or a
  // second parallel history opens for the same subreddit.
  const { articles } = run([feedItem('Banking')]);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].json.source_key, 'reddit:r_banking');
  assert.equal(articles[0].json.source_name, 'r/banking');
});

test('uses `id` (t3_...) as the dedupe key, since rss-parser exposes Atom <id> as id and not guid', () => {
  const { articles } = run([feedItem('banking', { id: 't3_1w4pf8f' })]);
  assert.equal(articles[0].json.reddit_post_id, 't3_1w4pf8f');
});

test('strips the "submitted by /u/name" trailer (no "to r/sub" half) and the [link]/[comments] markers', () => {
  const { articles } = run([feedItem('banking')]);
  const content = articles[0].json.content;
  assert.ok(!/submitted by/i.test(content), 'trailer must be stripped');
  assert.ok(!/\[link\]|\[comments\]/i.test(content), 'link/comments markers must be stripped');
  assert.ok(content.startsWith('I just had a seizure'), 'real body text must survive');
});

test('falls back to the HTML `content` field when contentSnippet is absent, stripping tags and entities', () => {
  const item = feedItem('banking');
  delete item.json.contentSnippet;
  const { articles } = run([item]);
  assert.equal(articles.length, 1);
  assert.ok(!/<[a-z]/i.test(articles[0].json.content), 'no HTML tags may survive');
  assert.ok(!/&#\d+;/.test(articles[0].json.content), 'no numeric entities may survive');
});

test('bare {} placeholders report "empty" for their subreddit and never reach the pool', () => {
  const { articles, events } = run(SUBS.map(placeholder));
  assert.equal(articles.length, 0);
  assert.equal(events.length, SUBS.length, 'one _fetch_event per registry subreddit');
  assert.ok(events.every((e) => e.json.status === 'empty'));
  assert.ok(events.every((e) => e.json.raw_count === 0));
});

test('reports "filtered_empty" when entries arrive but none survive the content-length floor', () => {
  const { articles, events } = run([feedItem('banking', { body: 'too short' })]);
  assert.equal(articles.length, 0);
  const ev = events.find((e) => e.json.source_key === 'reddit:r_banking');
  assert.equal(ev.json.status, 'filtered_empty');
  assert.equal(ev.json.raw_count, 1);
  assert.equal(ev.json.item_count, 0);
});

test('drops entries older than the 7-day window even though t=week scopes it server-side', () => {
  const stale = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { articles } = run([feedItem('banking', { isoDate: stale })]);
  assert.equal(articles.length, 0);
});

test('caps any single subreddit at PER_SUB_CAP (12)', () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    feedItem('banking', { id: 't3_post' + i, slug: 'post_' + i, body: BODY + ' Variation ' + i })
  );
  const { articles } = run(many);
  assert.equal(articles.length, 12);
});

test('dedupes by id across everything it receives', () => {
  const { articles } = run([feedItem('banking', { id: 't3_same' }), feedItem('banking', { id: 't3_same' })]);
  assert.equal(articles.length, 1);
});

test('fills the pool round-robin so one busy subreddit cannot crowd out the roster', () => {
  const busy = Array.from({ length: 12 }, (_, i) =>
    feedItem('FinancialCareers', { id: 't3_busy' + i, slug: 'busy_' + i, body: BODY + ' Busy ' + i })
  );
  const quiet = feedItem('talesfromcallcenters', { id: 't3_quiet', slug: 'quiet' });
  const { articles } = run([...busy, quiet]);
  // The quiet subreddit's single post must appear in the first round, not after
  // all 12 of the busy subreddit's — that ordering IS the round-robin.
  const quietIndex = articles.findIndex((a) => a.json.source_name === 'r/talesfromcallcenters');
  assert.ok(quietIndex > -1, 'quiet subreddit must be represented');
  assert.ok(quietIndex < 3, `quiet subreddit should land in the first round, got index ${quietIndex}`);
});

test('ignores entries from a subreddit that is not in the registry rather than inventing a source_key', () => {
  const { articles, events } = run([feedItem('SomeUnlistedSubreddit'), feedItem('banking')]);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].json.source_key, 'reddit:r_banking');
  assert.ok(!events.some((e) => /SomeUnlisted/i.test(e.json.source_key)));
});
