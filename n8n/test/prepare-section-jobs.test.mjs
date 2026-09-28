import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNode, json } from './harness.mjs';

const run = json({
  run_id: 'run-1',
  week_start: '2026-09-01',
  week_end: '2026-09-07'
});

function article(overrides = {}) {
  return json({
    source_type: 'rss',
    source_name: 'Test source',
    title: 'Test banking story',
    link: 'https://example.com/story',
    published_date: '2026-09-07',
    content: 'Substantive body text for the newsletter.',
    lob_tags: [],
    ai_research: false,
    ...overrides
  });
}

function prepare(items) {
  return runNode('prepare-section-jobs.js', items, { 'Initialize Run': [run] });
}

test('routes the merged pool into exactly the five requested sections', () => {
  const out = prepare([
    article({ title: 'Retail', link: 'https://example.com/retail', lob_tags: ['retail'] }),
    article({ title: 'Wealth', link: 'https://example.com/wealth', lob_tags: ['wealth'] }),
    article({ title: 'SME', link: 'https://example.com/sme', lob_tags: ['sme_commercial'] }),
    article({
      title: 'Call centre tooling',
      link: 'https://www.reddit.com/r/callcentres/comments/abc/tooling/',
      source_type: 'reddit',
      lob_tags: ['community']
    }),
    article({ title: 'Banking AI', link: 'https://example.com/ai', source_type: 'ai_research', ai_research: true })
  ]);

  assert.deepEqual(
    out.map((i) => i.json.section_id).sort(),
    ['banking_ai', 'employee', 'retail', 'sme_commercial', 'wealth']
  );
});

test('deduplicates URL and headline collisions before section routing', () => {
  const out = prepare([
    article({ title: 'Same story - Outlet A', link: 'https://news.google.com/rss/articles/ABC?oc=5', lob_tags: ['retail'] }),
    article({ title: 'Same story - Outlet B', link: 'https://publisher.com/story', content: 'A much better direct article body.', lob_tags: ['retail'] })
  ]);
  const retail = out.find((i) => i.json.section_id === 'retail').json;
  assert.equal(retail.articles_collected, 2);
  assert.equal(retail.articles_after_dedup, 1);
  assert.equal(JSON.parse(retail.facts_json).length, 1);
  assert.equal(JSON.parse(retail.facts_json)[0].link, 'https://publisher.com/story');
});

test('attaches employee facts to every non-employee section job', () => {
  const out = prepare([
    article({ title: 'Retail', link: 'https://example.com/retail', lob_tags: ['retail'] }),
    article({
      title: 'Branch staff struggle with service tooling',
      link: 'https://www.reddit.com/r/CustomerService/comments/abc/tools/',
      source_type: 'reddit'
    })
  ]);
  const retail = out.find((i) => i.json.section_id === 'retail').json;
  const employee = out.find((i) => i.json.section_id === 'employee').json;
  assert.equal(retail.employee_fact_count, 1);
  assert.equal(JSON.parse(retail.employee_facts_json).length, 1);
  assert.equal(employee.employee_fact_count, 0);
  assert.deepEqual(JSON.parse(employee.employee_facts_json), []);
});

test('deduplication preserves routing tags from every copy of a story', () => {
  const out = prepare([
    article({
      title: 'Shared launch - Outlet A',
      link: 'https://example.com/shared?utm_source=a',
      lob_tags: ['retail']
    }),
    article({
      title: 'Shared launch - Outlet B',
      link: 'https://example.com/shared',
      lob_tags: ['wealth'],
      source_type: 'ai_research',
      ai_research: true
    })
  ]);
  const sections = new Set(out.map((i) => i.json.section_id));
  assert.ok(sections.has('retail'));
  assert.ok(sections.has('wealth'));
  assert.ok(sections.has('banking_ai'));
});

test('drops fetch-event markers before counting or routing', () => {
  const out = prepare([
    article({ lob_tags: ['retail'] }),
    json({ _fetch_event: true, source_type: 'rss', status: 'ok' })
  ]);
  assert.equal(out[0].json.articles_collected, 1);
});
