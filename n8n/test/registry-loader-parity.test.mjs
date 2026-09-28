// Registry-loader parity: every Load* node reads its registry via the
// @data directive (see build-workflow.mjs), so these should never be able
// to drift from each other in normal use. These tests exist to catch the
// one way they still could: someone editing a loader's OWN filtering logic
// (e.g. narrowing "active" or "Tier A") without the registry agreeing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNode, loadRegistry } from './harness.mjs';

test('load-rss-sources.js emits exactly one item per non-quarantined rss-sources.json entry', () => {
  const registry = loadRegistry('rss-sources.json');
  const expected = registry.sources.filter((s) => s.status !== 'quarantined');
  const out = runNode('load-rss-sources.js', []);
  assert.equal(out.length, expected.length);
  const expectedKeys = new Set(expected.map((s) => s.source_key));
  for (const item of out) assert.ok(expectedKeys.has(item.json.source_key), `unexpected source_key ${item.json.source_key}`);
});

test('load-customer-banks.js emits exactly one item per Tier A bank', () => {
  const registry = loadRegistry('customer-banks.json');
  const expected = registry.banks.filter((b) => b.tier === 'A');
  const out = runNode('load-customer-banks.js', []);
  assert.equal(out.length, expected.length);
});

test('load-competitor-watchlist.js emits exactly one item per distinct vendor name across cross_cutting + by_lob', () => {
  const registry = loadRegistry('competitor-watch.json');
  const names = new Set((registry.cross_cutting || []).map((v) => v.name));
  for (const entries of Object.values(registry.by_lob || {})) {
    for (const v of entries) names.add(v.name);
  }
  const out = runNode('load-competitor-watchlist.js', []);
  assert.equal(out.length, names.size);
});

test('load-reddit-sources.js emits exactly one item per subreddit in reddit-sources.json, in list order', () => {
  const registry = loadRegistry('reddit-sources.json');
  const out = runNode('load-reddit-sources.js', []);
  assert.equal(out.length, registry.subreddits.length);
  assert.deepEqual(out.map((i) => i.json.subreddit), registry.subreddits.map((s) => s.name));
  assert.deepEqual(out.map((i) => i.json.priority), registry.subreddits.map((s) => s.priority));
});

test('load-ai-research-sources.js emits general_ai_rss (non-quarantined) + all targeted_google_news_queries', () => {
  const registry = loadRegistry('ai-research-sources.json');
  const expectedGeneral = (registry.general_ai_rss || []).filter((s) => s.status !== 'quarantined').length;
  const expectedTargeted = (registry.targeted_google_news_queries || []).length;
  const out = runNode('load-ai-research-sources.js', []);
  assert.equal(out.filter((i) => i.json.origin === 'general').length, expectedGeneral);
  assert.equal(out.filter((i) => i.json.origin === 'targeted').length, expectedTargeted);
});

test('every registry has at least one active source (a registry that resolves to zero would build a workflow fetching nothing)', () => {
  assert.ok(loadRegistry('rss-sources.json').sources.some((s) => s.status !== 'quarantined'));
  assert.ok(loadRegistry('customer-banks.json').banks.some((b) => b.tier === 'A'));
  assert.ok(loadRegistry('reddit-sources.json').subreddits.length > 0);
  const ai = loadRegistry('ai-research-sources.json');
  assert.ok((ai.general_ai_rss || []).length + (ai.targeted_google_news_queries || []).length > 0);
});
