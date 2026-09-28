import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPoolHelpers, rss2, atom, cloudflareChallengeHtml } from './harness.mjs';

const { looksLikeFeed } = loadPoolHelpers();

test('looksLikeFeed accepts RSS 2.0', () => {
  const xml = rss2({ items: [{ title: 'a', link: 'https://x.com/a', pubDate: 'Mon, 01 Sep 2026 12:00:00 GMT' }] });
  assert.equal(looksLikeFeed(xml), true);
});

test('looksLikeFeed accepts Atom', () => {
  const xml = atom({ entries: [{ title: 'a', link: 'https://x.com/a', updated: '2026-09-01T00:00:00Z' }] });
  assert.equal(looksLikeFeed(xml), true);
});

test('looksLikeFeed accepts RDF (RSS 1.0)', () => {
  const xml = '<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><item/></rdf:RDF>';
  assert.equal(looksLikeFeed(xml), true);
});

test('looksLikeFeed rejects a Cloudflare "Just a moment..." challenge page (HTTP 200, HTML body)', () => {
  assert.equal(looksLikeFeed(cloudflareChallengeHtml()), false);
});

test('looksLikeFeed rejects an empty body', () => {
  assert.equal(looksLikeFeed(''), false);
  assert.equal(looksLikeFeed(undefined), false);
});

test('looksLikeFeed rejects a generic HTML section page (e.g. a redirected/retired feed URL)', () => {
  const html = '<!DOCTYPE html><html><head><title>Banking News</title></head><body><h1>Latest</h1></body></html>';
  assert.equal(looksLikeFeed(html), false);
});
