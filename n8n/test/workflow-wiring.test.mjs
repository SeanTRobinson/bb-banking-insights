// Structural checks on the GENERATED workflow JSON. build-workflow.mjs's own
// `validate` section already runs these classes of check (duplicate names,
// dangling connections, unresolved $('...') references, continueErrorOutput
// nodes with an unwired error output, empty registries) on every build and
// would exit 1 before ever writing the file — so the fact that the build
// step in this test suite's `before()` succeeds is itself part of the
// coverage. What follows re-checks a few invariants directly against the
// emitted JSON, both as a second independent pass and to assert the SHAPE
// of the new scan-gate wiring specifically (which build-workflow.mjs's own
// generic checks don't know is supposed to look a particular way).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { N8N_ROOT } from './harness.mjs';
import { join } from 'node:path';

let workflow;

before(() => {
  execFileSync('node', ['build-workflow.mjs'], { cwd: N8N_ROOT });
  workflow = JSON.parse(readFileSync(join(N8N_ROOT, 'backbase-insights-v4.json'), 'utf8'));
});

function byName(name) {
  const n = workflow.nodes.find((x) => x.name === name);
  assert.ok(n, `node "${name}" must exist in the generated workflow`);
  return n;
}

test('build-workflow.mjs --check reports the committed JSON as up to date', () => {
  // Fails loudly (non-zero exit) if backbase-insights-v4.json is stale —
  // execFileSync throws on nonzero exit, which is the assertion here.
  execFileSync('node', ['build-workflow.mjs', '--check'], { cwd: N8N_ROOT });
});

test('every node name is unique', () => {
  const names = workflow.nodes.map((n) => n.name);
  assert.equal(names.length, new Set(names).size);
});

test('every connection points at a node that exists', () => {
  const names = new Set(workflow.nodes.map((n) => n.name));
  for (const [from, conn] of Object.entries(workflow.connections)) {
    assert.ok(names.has(from), `connection source "${from}" does not exist`);
    for (const outputs of Object.values(conn)) {
      for (const targets of outputs) {
        for (const t of targets || []) {
          assert.ok(names.has(t.node), `${from} -> unknown node "${t.node}"`);
        }
      }
    }
  }
});

test('every fetch node with onError=continueErrorOutput has a real second (error) output wired', () => {
  // Reddit Fetch is absent: it uses continueRegularOutput (one output) so that
  // a failed subreddit re-joins the loop by the same edge as a successful one.
  const fetchNodeNames = [
    'RSS Fetch', 'Customer Google News', 'Competitor Google News',
    'AI Research Fetch', 'PR Newswire Fetch'
  ];
  for (const name of fetchNodeNames) {
    const node = byName(name);
    assert.equal(node.onError, 'continueErrorOutput', `${name} must continue on its error output`);
    const outputs = workflow.connections[name].main;
    assert.ok(outputs.length >= 2, `${name} must have 2 wired outputs`);
    assert.ok(outputs[1] && outputs[1].length > 0, `${name}'s error output (index 1) must be wired`);
  }
});

// Reddit Fetch is deliberately excluded here, unlike every other fetch node:
// its error output goes to 'Tag Reddit Failure' first, not straight to
// 'Shape Fetch Failure'. It HAS to — 'Reddit Wait' (and through it, 'Reddit
// Loop') needs exactly one item flowing back from every iteration, success
// or failure, to keep looping over the remaining subreddits; routing
// straight to 'Shape Fetch Failure' (a dead end that only feeds 'Record
// Fetch Failures') would strand the loop on subreddit 1's first error the
// same way a v1-style unhandled 429 did. Reddit's per-subreddit failures are
// still tracked, just through source_health instead of source_fetch_failures
// — see normalize-reddit-item.js's _fetch_event emission and
// record-source-health-events.js.
test('every non-Reddit fetch node error output converges on Shape Fetch Failure', () => {
  const fetchNodeNames = [
    'RSS Fetch', 'Customer Google News', 'Competitor Google News',
    'AI Research Fetch', 'PR Newswire Fetch'
  ];
  for (const name of fetchNodeNames) {
    const errorTargets = workflow.connections[name].main[1].map((t) => t.node);
    assert.deepEqual(errorTargets, ['Shape Fetch Failure'], `${name}'s error output must go to Shape Fetch Failure`);
  }
  assert.deepEqual(
    workflow.connections['Shape Fetch Failure'].main[0].map((t) => t.node),
    ['Record Fetch Failures']
  );
});

test('Reddit Fetch is a Loop Over Items-driven native RSS Feed Read whose every outcome re-joins the loop', () => {
  const reddit = byName('Reddit Fetch');
  assert.equal(reddit.type, 'n8n-nodes-base.rssFeedRead');
  assert.equal(reddit.alwaysOutputData, true, 'an empty or failed subreddit must still emit one item, or the loop has nothing to re-trigger it with and every later subreddit is stranded');
  assert.equal(reddit.onError, 'continueRegularOutput', 'one output only, so a failure follows the same edge back into the loop as a success');

  const loop = byName('Reddit Loop');
  assert.equal(loop.type, 'n8n-nodes-base.splitInBatches');
  assert.equal(loop.parameters.batchSize, 1, 'the RSS Feed Read node has no batching/interval option of its own, so this is what spaces the 16 requests out');

  const wait = byName('Reddit Wait');
  assert.equal(wait.type, 'n8n-nodes-base.wait');
  assert.ok(wait.parameters.amount > 0, 'the wait is what stops Reddit answering request 1 and refusing the other 15');

  assert.deepEqual(workflow.connections['Load Reddit Sources'].main[0].map((t) => t.node), ['Reddit Loop']);
  assert.deepEqual(workflow.connections['Reddit Loop'].main[0].map((t) => t.node), ['Reddit Fetch'], 'loop output feeds the fetch');
  assert.deepEqual(workflow.connections['Reddit Loop'].main[1].map((t) => t.node), ['Normalize Reddit Item'], 'done output feeds the normalizer');
  assert.deepEqual(workflow.connections['Reddit Fetch'].main[0].map((t) => t.node), ['Reddit Wait']);
  assert.deepEqual(workflow.connections['Reddit Wait'].main[0].map((t) => t.node), ['Reddit Loop'], 'closes the loop');
});

test('nothing between Reddit Fetch and Normalize Reddit Item re-tags entries (identity comes from the permalink)', () => {
  const names = new Set(workflow.nodes.map((n) => n.name));
  assert.ok(!names.has('Tag Reddit Item'), 'removed: entries already carry their subreddit in the /r/<sub>/ link');
  assert.ok(!names.has('Tag Reddit Failure'), 'removed along with the continueErrorOutput branch it existed to re-join');
});

test('scheduled and dry-run trigger paths converge on Initialize Run', () => {
  assert.deepEqual(workflow.connections['Set dryRun false'].main[0].map((t) => t.node), ['Initialize Run']);
  assert.deepEqual(workflow.connections['Set dryRun true'].main[0].map((t) => t.node), ['Initialize Run']);
});

test('post-merge workflow is the minimal five-section pipeline', () => {
  const expected = [
    ['Merge All Sources', 'Prepare Section Jobs'],
    ['Prepare Section Jobs', 'Write Section'],
    ['Write Section', 'Guard + Assemble Sections'],
    ['Guard + Assemble Sections', 'Write Executive Brief'],
    ['Write Executive Brief', 'Assemble Newsletter JSON'],
    ['Assemble Newsletter JSON', 'Generate HTML']
  ];
  for (const [from, to] of expected) {
    assert.deepEqual(workflow.connections[from].main[0].map((t) => t.node), [to]);
  }
});

test('removed gate, ledger and curator nodes are absent', () => {
  const names = new Set(workflow.nodes.map((n) => n.name));
  for (const name of [
    'Compute Canonical URL', 'Build Coverage Report', 'Apply Coverage Gate',
    'Mark Seen', 'Filter New Only', 'Build Curator Input', 'Curate Edition',
    'Build Section Jobs', 'If Scan Only', 'If Skip Dedup'
  ]) {
    assert.ok(!names.has(name), `${name} should not survive the simplified graph`);
  }
});

test('Dry Run Stop is a true dead end', () => {
  assert.equal(workflow.connections['Dry Run Stop'], undefined);
});

test('the two model nodes ship without a credential (so n8n flags them as needing attention, not silently broken)', () => {
  for (const name of ['Claude Sonnet', 'Claude Haiku (JSON Fixer)']) {
    const node = byName(name);
    assert.equal(node.credentials, undefined);
  }
});
