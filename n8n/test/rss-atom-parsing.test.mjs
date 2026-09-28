import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPoolHelpers, rss2, atom } from './harness.mjs';

const { parseFeedEntries, decodeEntities, unwrapCdata } = loadPoolHelpers();

test('parseFeedEntries reads RSS 2.0 items', () => {
  const xml = rss2({
    items: [
      { title: 'American Banker story', link: 'https://americanbanker.com/a', pubDate: 'Mon, 01 Sep 2026 12:00:00 GMT', description: 'Some body text' },
      { title: 'Second story', link: 'https://americanbanker.com/b', pubDate: 'Tue, 02 Sep 2026 12:00:00 GMT' }
    ]
  });
  const entries = parseFeedEntries(xml);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].title, 'American Banker story');
  assert.equal(entries[0].link, 'https://americanbanker.com/a');
  assert.equal(entries[0].content, 'Some body text');
  assert.ok(entries[0].published);
});

test('parseFeedEntries reads Atom entries, preferring rel="alternate" over rel="self"', () => {
  const xml =
    '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">' +
    '<entry><title>Reddit-style post</title>' +
    '<link rel="self" href="https://www.reddit.com/r/banking/top/.rss"/>' +
    '<link rel="alternate" href="https://www.reddit.com/r/banking/comments/abc123/post/"/>' +
    '<id>abc123</id><updated>2026-09-05T00:00:00Z</updated>' +
    '<content>submitted by u/x to r/banking [link] [3 comments] actual discussion body here</content>' +
    '</entry></feed>';
  const entries = parseFeedEntries(xml);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].link, 'https://www.reddit.com/r/banking/comments/abc123/post/');
});

test('parseFeedEntries strips CDATA-wrapped titles (American Banker / Arizent feeds)', () => {
  const xml =
    '<?xml version="1.0"?><rss version="2.0"><channel>' +
    '<item><title><![CDATA[Ask an Advisor: what to do]]></title>' +
    '<link>https://example.com/a</link><guid>g1</guid>' +
    '<pubDate>Mon, 01 Sep 2026 12:00:00 GMT</pubDate>' +
    '<description><![CDATA[<p>Some <b>HTML</b> body</p>]]></description></item>' +
    '</channel></rss>';
  const entries = parseFeedEntries(xml);
  assert.equal(entries[0].title, 'Ask an Advisor: what to do');
  // HTML tags stripped, entity-decoded, whitespace collapsed.
  assert.equal(entries[0].content, 'Some HTML body');
});

test('parseFeedEntries drops entries with no title or no link', () => {
  const xml =
    '<?xml version="1.0"?><rss version="2.0"><channel>' +
    '<item><title></title><link>https://example.com/a</link><guid>g1</guid></item>' +
    '<item><title>Has no link</title><link></link><guid>g2</guid></item>' +
    '<item><title>Valid</title><link>https://example.com/c</link><guid>g3</guid></item>' +
    '</channel></rss>';
  const entries = parseFeedEntries(xml);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, 'Valid');
});

test('decodeEntities handles Reddit double-encoded entities in one call (via double pass)', () => {
  // Reddit's raw Atom literally contains "&amp;#32;" for a space, not "&#32;".
  const doubleEncoded = 'submitted&amp;#32;by&amp;#32;u/x';
  assert.equal(decodeEntities(doubleEncoded), 'submitted by u/x');
});

test('decodeEntities is a no-op (safe) on already-clean text', () => {
  assert.equal(decodeEntities('Plain text, no entities here.'), 'Plain text, no entities here.');
});

test('decodeEntitiesOnce (single pass) resolves &amp; last, so &amp;lt; becomes &lt; rather than over-decoding to <', () => {
  // decodeEntities (the double pass used for Reddit's double-encoding) would
  // legitimately turn this into "<" on its second pass — that trade-off is
  // documented and accepted in pool-helpers.js. The single-pass ordering
  // guarantee is what's actually load-bearing, and normalize-*.js's own
  // single-encoded feeds (everything except Reddit) never take the second pass
  // on a value that still has first-generation entities left in it.
  const { decodeEntitiesOnce } = loadPoolHelpers();
  assert.equal(decodeEntitiesOnce('literal &amp;lt; text'), 'literal &lt; text');
});

test('unwrapCdata strips wrapper but leaves plain strings unchanged', () => {
  assert.equal(unwrapCdata('<![CDATA[hello]]>'), 'hello');
  assert.equal(unwrapCdata('plain string'), 'plain string');
});
