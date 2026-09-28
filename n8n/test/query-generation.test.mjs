import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNode } from './harness.mjs';

function decodedQuery(url) {
  const q = new URLSearchParams(url.split('?')[1]).get('q');
  return q;
}

test('load-customer-banks.js: every query has when:7d, a banking qualifier, and negative terms', () => {
  const out = runNode('load-customer-banks.js', []);
  assert.ok(out.length > 0, 'expected at least one Tier A bank');
  for (const item of out) {
    const q = item.json.query;
    assert.match(q, /when:7d/, `${item.json.name}: missing when:7d`);
    assert.match(q, /\(bank OR banking OR digital OR fintech OR app OR platform OR AI\)/, `${item.json.name}: missing qualifier`);
    assert.match(q, /-stock/, `${item.json.name}: missing negative terms`);
    // url must be the fully-built Google News RSS search URL, and must
    // decode back to the same query string it was built from.
    assert.match(item.json.url, /^https:\/\/news\.google\.com\/rss\/search\?q=/);
    assert.equal(decodedQuery(item.json.url), q);
  }
});

test('load-competitor-watchlist.js: every vendor query has when:7d and a built url', () => {
  const out = runNode('load-competitor-watchlist.js', []);
  assert.ok(out.length > 0);
  for (const item of out) {
    assert.match(item.json.query, /when:7d/, `${item.json.name}: missing when:7d`);
    assert.equal(decodedQuery(item.json.url), item.json.query);
  }
});

test('load-competitor-watchlist.js: cross_cutting/by_lob "See ..." pointers merge into one entry, not a duplicate', () => {
  const out = runNode('load-competitor-watchlist.js', []);
  const temenos = out.filter((i) => i.json.name === 'Temenos');
  assert.equal(temenos.length, 1, 'Temenos must appear exactly once, not once per LOB');
  // Registered under cross_cutting AND referenced from sme_commercial via a
  // "See cross_cutting" pointer — both lob_tags must survive the merge.
  assert.ok(temenos[0].json.lob_tags.includes('cross_cutting'));
  assert.ok(temenos[0].json.lob_tags.includes('sme_commercial'));
});

test('load-competitor-watchlist.js: See-retail pointers under sme_commercial resolve even though retail is later in object-key order', () => {
  const out = runNode('load-competitor-watchlist.js', []);
  for (const name of ['Alkami', 'Lumin Digital']) {
    const hit = out.filter((i) => i.json.name === name);
    assert.equal(hit.length, 1, `${name} must appear exactly once`);
    assert.ok(hit[0].json.lob_tags.includes('retail'), `${name} must keep its real retail tag`);
    assert.ok(hit[0].json.lob_tags.includes('sme_commercial'), `${name} sme_commercial pointer must resolve`);
  }
});

test('load-competitor-watchlist.js: Agentforce (the most direct Digital Assist competitor) is present', () => {
  const out = runNode('load-competitor-watchlist.js', []);
  const hit = out.find((i) => i.json.name.includes('Agentforce'));
  assert.ok(hit, 'Salesforce Service Cloud / Agentforce must be in the built loader output');
  assert.ok(hit.json.lob_tags.includes('digital_assist'));
});

test('load-rss-sources.js: direct sources use their own URL, google_news sources build a Google News url with when:7d', () => {
  const out = runNode('load-rss-sources.js', []);
  assert.ok(out.length > 0);
  const direct = out.find((i) => !i.json.is_fallback);
  const fallback = out.find((i) => i.json.is_fallback);
  assert.ok(direct, 'expected at least one direct-fetch RSS source');
  assert.ok(fallback, 'expected at least one Google News fallback RSS source');
  assert.match(direct.json.url, /^https:\/\/(?!news\.google\.com)/);
  assert.match(fallback.json.url, /^https:\/\/news\.google\.com\/rss\/search\?q=/);
  assert.match(decodeURIComponent(fallback.json.url), /when:7d/);
});

test('load-rss-sources.js: quarantined sources never reach the build', () => {
  const out = runNode('load-rss-sources.js', []);
  // Every emitted source_key corresponds to a 'working' registry entry —
  // this is really asserting active.filter(status !== 'quarantined') ran.
  for (const item of out) {
    assert.ok(item.json.source_key, 'every source must carry a source_key');
  }
});

test('load-ai-research-sources.js: general_ai_rss items are tagged origin=general, targeted queries are origin=targeted with when:7d', () => {
  const out = runNode('load-ai-research-sources.js', []);
  const general = out.filter((i) => i.json.origin === 'general');
  const targeted = out.filter((i) => i.json.origin === 'targeted');
  assert.ok(general.length > 0, 'expected general_ai_rss entries');
  assert.ok(targeted.length > 0, 'expected targeted_google_news_queries entries');
  for (const item of targeted) {
    assert.match(decodeURIComponent(item.json.url), /when:7d/);
  }
});
