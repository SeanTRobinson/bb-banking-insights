// Shared test harness: runs a node-code/*.js file (or a node's fully-built
// body, post @include/@data resolution) the same way n8n would, with mocked
// Code-node globals. This is what lets every test in this directory exercise
// the ACTUAL source that ships, not a copy re-typed into a spec file — a
// spec that re-implements parseFeedEntries would drift from the real one
// and pass even after a real regression.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const N8N_ROOT = join(here, '..');
export const DATA_ROOT = join(N8N_ROOT, '..', 'data');

// Resolves @include and @data directives exactly like build-workflow.mjs's
// `code()` function does, so a node-code/*.js file can be exercised standalone.
export function resolveSource(nodeCodeFile) {
  const p = join(N8N_ROOT, 'node-code', nodeCodeFile);
  let src = readFileSync(p, 'utf8');
  src = src.replace(/^\/\/ @include (\S+)[^\n]*$/gm, (_, target) =>
    readFileSync(join(N8N_ROOT, 'node-code', target), 'utf8').replace(/\s+$/, '')
  );
  src = src.replace(/^\/\/ @data (\S+) as ([A-Z_][A-Z0-9_]*)[^\n]*$/gm, (_, target, varName) => {
    const obj = JSON.parse(readFileSync(join(N8N_ROOT, target), 'utf8'));
    return `const ${varName} = ${JSON.stringify(obj)};`;
  });
  if (/^\/\/ @include /m.test(src)) throw new Error(`${nodeCodeFile}: unresolved @include`);
  if (/^\/\/ @data /m.test(src)) throw new Error(`${nodeCodeFile}: unresolved @data`);
  return src;
}

// Gets one node's FINAL body straight from build-workflow.mjs (--node),
// for the handful of nodes whose logic build-workflow.mjs itself generates
// (e.g. FETCH_NODES' HTTP params) rather than copying from node-code/.
export function builtNodeSource(nodeName) {
  return execFileSync('node', ['build-workflow.mjs', '--node', nodeName], {
    cwd: N8N_ROOT,
    maxBuffer: 10 * 1024 * 1024
  }).toString();
}

// linkedNodes: { 'Node Name': [{json}, ...] } — index i must line up with
// inputItems[i], matching how $('Node Name').itemMatching(i) is positional
// in n8n (both arrays walk the same fan-out). first()/all() ignore i.
export function runSource(src, inputItems, linkedNodes = {}) {
  const $input = { all: () => inputItems, first: () => inputItems[0] };
  const $ = (nodeName) => ({
    itemMatching: (i) => {
      const arr = linkedNodes[nodeName];
      if (!arr) throw new Error(`no mocked linkedNodes entry for "${nodeName}"`);
      if (!arr[i]) throw new Error(`linkedNodes["${nodeName}"][${i}] is undefined`);
      return arr[i];
    },
    all: () => linkedNodes[nodeName] || [],
    first: () => (linkedNodes[nodeName] || [])[0]
  });
  // n8n exposes $json as shorthand for the current item's json regardless of
  // Code node mode; a few single-item trigger-adjacent nodes (Initialize Run)
  // use it directly instead of $input.first().json, matching v3's original.
  const $json = inputItems[0] ? inputItems[0].json : {};
  const fn = new Function('$input', '$json', '$', 'console', src);
  return fn($input, $json, $, console);
}

export function runNode(nodeCodeFile, inputItems, linkedNodes = {}) {
  return runSource(resolveSource(nodeCodeFile), inputItems, linkedNodes);
}

export function json(payload) {
  return { json: payload };
}

export function loadRegistry(file) {
  return JSON.parse(readFileSync(join(DATA_ROOT, file), 'utf8'));
}

// shared/pool-helpers.js has no module.exports (Code nodes have no module
// system — see build-workflow.mjs's @include comment) — every function and
// const in it is just a top-level declaration. Wrapping it in a Function
// that returns an object literal of those names is what lets tests call
// parseFeedEntries/looksLikeFeed/etc. directly instead of only observing
// them indirectly through a whole normalizer.
const POOL_HELPERS_EXPORTS = [
  'escapeRe', 'decodeEntitiesOnce', 'decodeEntities', 'bodyOf', 'looksLikeFeed',
  'firstMatch', 'unwrapCdata', 'parseFeedEntries', 'hostOf', 'publisherFromTitle',
  'headlineOf', 'matchTextOf', 'LOB_KEYWORDS', 'BLOCKED_PUBLISHERS', 'isBlockedPublisher',
  'AI_LENS_KEYWORDS', 'looksAiRelevant', 'ANALYST_NOISE_RE', 'inferLobTags', 'mergeTags'
];

export function loadPoolHelpers() {
  const src = readFileSync(join(N8N_ROOT, 'node-code', 'shared', 'pool-helpers.js'), 'utf8');
  const fn = new Function(`${src}\nreturn { ${POOL_HELPERS_EXPORTS.join(', ')} };`);
  return fn();
}

// A minimal but structurally valid RSS 2.0 document, for feed-shape tests
// that only care about item count / fields, not a specific publisher's quirks.
export function rss2({ items }) {
  return (
    '<?xml version="1.0"?><rss version="2.0"><channel><title>Test Feed</title>' +
    items
      .map(
        (it) =>
          `<item><title>${it.title}</title><link>${it.link}</link>` +
          `<guid>${it.guid || it.link}</guid><pubDate>${it.pubDate}</pubDate>` +
          `<description>${it.description || ''}</description></item>`
      )
      .join('') +
    '</channel></rss>'
  );
}

export function atom({ entries }) {
  return (
    '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Test Feed</title>' +
    entries
      .map(
        (e) =>
          `<entry><title>${e.title}</title><link rel="alternate" href="${e.link}"/>` +
          `<id>${e.id || e.link}</id><updated>${e.updated}</updated>` +
          `<content>${e.content || ''}</content></entry>`
      )
      .join('') +
    '</feed>'
  );
}

// A byte-for-byte-plausible Cloudflare "Just a moment..." interstitial —
// modeled on the real captures cited in shared/pool-helpers.js's
// looksLikeFeed comment (Finextra, The Financial Brand, FinTech Futures...).
export function cloudflareChallengeHtml() {
  return (
    '<!DOCTYPE html><html><head><title>Just a moment...</title></head>' +
    '<body><div class="cf-browser-verification">Checking your browser before ' +
    'accessing the site.</div><script>window._cf_chl_opt = {};</script></body></html>'
  );
}
