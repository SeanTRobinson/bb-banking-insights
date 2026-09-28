#!/usr/bin/env node
// Generates newsletter/n8n/backbase-insights-v4.json — the workflow you import
// into n8n. Nothing in that file should ever be hand-edited; it is assembled
// from four reviewable sources:
//
//   backbase-insights-workflow.json  the v3 workflow, for the ingestion and
//                                    delivery nodes carried over unchanged
//   node-code/*.js                   Code node bodies
//   ../prompts/*.md                  LLM system + user prompts, between the
//                                    <!-- SYSTEM PROMPT START --> markers
//   schemas/*.json                   structured-output JSON Schemas
//
//   node newsletter/n8n/build-workflow.mjs
//   node newsletter/n8n/build-workflow.mjs --check   # exit 1 if stale
//   node newsletter/n8n/build-workflow.mjs --node "Normalize RSS Item"
//                                                  # print one node's final
//                                                  # body, to paste by hand
//
// Re-import the generated file in n8n after building.

import { readFileSync, writeFileSync, existsSync, mkdirSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const legacyPath = join(here, 'backbase-insights-workflow.json');
const outPath = join(here, 'backbase-insights-v4.json');

const ANTHROPIC_CREDENTIAL = 'Anthropic (Backbase Insights)';
const MAIN_MODEL = 'claude-sonnet-4-5-20250929';
const FIXER_MODEL = 'claude-3-5-haiku-20241022';

// ---------------------------------------------------------------- helpers ---

// `// @data ../../data/foo.json as NAME` inlines a registry file as a JS
// const. This is what makes the JSON registries under newsletter/data/ the
// actual source of truth instead of documentation for a hand-maintained
// array: the Load* Code nodes used to carry their own copy of every bank,
// vendor and feed URL, and the registry was "keep in sync manually" —
// American Banker was marked 'working' in the registry for months after its
// URL started 404ing, because nothing ever read that file at build time.
const dataFile = (file) => {
  const p = join(here, file);
  if (!existsSync(p)) throw new Error(`missing ${file}`);
  return JSON.parse(readFileSync(p, 'utf8'));
};

// `// @include shared/foo.js` inlines another node-code file at that line.
// Code nodes have no module system, so helpers shared by several nodes have to
// be copied into each body — this keeps one reviewable copy in the repo.
const code = (file) => {
  const p = join(here, 'node-code', file);
  if (!existsSync(p)) throw new Error(`missing node-code/${file}`);
  let body = readFileSync(p, 'utf8').replace(
    /^\/\/ @include (\S+)[^\n]*$/gm,
    (_, target) => {
      const t = join(here, 'node-code', target);
      if (!existsSync(t)) throw new Error(`${file} includes missing node-code/${target}`);
      return readFileSync(t, 'utf8').replace(/\s+$/, '');
    }
  );
  body = body.replace(
    /^\/\/ @data (\S+) as ([A-Z_][A-Z0-9_]*)[^\n]*$/gm,
    (_, target, varName) => {
      let obj;
      try {
        obj = dataFile(target);
      } catch (e) {
        throw new Error(`${file} @data ${target}: ${e.message}`);
      }
      return `const ${varName} = ${JSON.stringify(obj)};`;
    }
  );
  if (/^\/\/ @include /m.test(body)) throw new Error(`${file} has an unresolved @include`);
  if (/^\/\/ @data /m.test(body)) throw new Error(`${file} has an unresolved @data`);
  return body.replace(/\s+$/, '') + '\n';
};

const schema = (file) => {
  const p = join(here, 'schemas', file);
  if (!existsSync(p)) throw new Error(`missing schemas/${file}`);
  return JSON.stringify(JSON.parse(readFileSync(p, 'utf8')), null, 2);
};

function section(file, marker) {
  const p = join(here, '..', 'prompts', file);
  if (!existsSync(p)) throw new Error(`missing prompts/${file}`);
  const text = readFileSync(p, 'utf8');
  const re = new RegExp(`<!-- ${marker} START -->\\n([\\s\\S]*?)\\n<!-- ${marker} END -->`);
  const m = text.match(re);
  if (!m) throw new Error(`prompts/${file} has no ${marker} markers`);
  return m[1].trim();
}

// The chain's `text` field tolerates curly braces (n8n#7553), but the system
// message still goes through LangChain's f-string template, where a literal
// brace throws "Single '{' in template". Catch that at build time rather than
// at 6am on a Monday.
function systemPrompt(file) {
  const body = section(file, 'SYSTEM PROMPT');
  if (/[{}]/.test(body)) {
    throw new Error(
      `prompts/${file}: system prompt contains a curly brace, which breaks the ` +
        `LangChain prompt template. Describe the shape in words instead.`
    );
  }
  return body;
}

const userPrompt = (file) => '=' + section(file, 'USER PROMPT');

let idSeq = 200;
const nextId = () => '00000000-0000-0000-0000-' + String(++idSeq).padStart(12, '0');

const codeNode = (name, file, position) => ({
  parameters: { jsCode: code(file) },
  id: nextId(),
  name,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position
});

// Loop Over Items with a fixed batch size of 1 — the only way to drive the
// native RSS Feed Read node (which "only processes the first item it
// receives" per n8n's own docs) across more than one URL. Used for Reddit's
// 16-subreddit fetch; see build-workflow.mjs's REDDIT_FETCH_NOTES.
const loopNode = (name, position) => ({
  parameters: { batchSize: 1, options: {} },
  id: nextId(),
  name,
  type: 'n8n-nodes-base.splitInBatches',
  typeVersion: 3,
  position
});

// Fixed-duration pause, used between Loop Over Items iterations so 16
// sequential subreddit fetches do not go out back-to-back.
const waitNode = (name, seconds, position) => ({
  parameters: { resume: 'timeInterval', amount: seconds, unit: 'seconds' },
  id: nextId(),
  name,
  type: 'n8n-nodes-base.wait',
  typeVersion: 1.1,
  position,
  webhookId: nextId()
});

const chainNode = (name, promptFile, position, notes) => ({
  parameters: {
    promptType: 'define',
    text: userPrompt(promptFile),
    hasOutputParser: true,
    messages: {
      messageValues: [
        { type: 'SystemMessagePromptTemplate', message: systemPrompt(promptFile) }
      ]
    }
  },
  id: nextId(),
  name,
  type: '@n8n/n8n-nodes-langchain.chainLlm',
  typeVersion: 1.5,
  position,
  notes,
  notesInFlow: true,
  retryOnFail: true,
  maxTries: 2,
  waitBetweenTries: 3000
});

// No `credentials` key on purpose: a placeholder credential id imports as a
// broken reference that looks configured. Leaving it unset makes n8n show the
// model nodes as needing attention, which is exactly what they need.
const modelNode = (name, model, maxTokens, position) => ({
  parameters: {
    model: { __rl: true, mode: 'id', value: model },
    options: { maxTokensToSample: maxTokens, temperature: 0.3 }
  },
  id: nextId(),
  name,
  type: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
  typeVersion: 1.3,
  position,
  notes: `Set the ${ANTHROPIC_CREDENTIAL} credential here after import`,
  notesInFlow: false
});

const parserNode = (name, schemaFile, position) => ({
  parameters: { schemaType: 'manual', inputSchema: schema(schemaFile), autoFix: true },
  id: nextId(),
  name,
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  typeVersion: 1.2,
  position
});

// ------------------------------------------------------------- base graph ---

const legacy = JSON.parse(readFileSync(legacyPath, 'utf8'));
const legacyByName = new Map(legacy.nodes.map((n) => [n.name, n]));

// Fetching and normalising, ending at the merged article pool.
// 'Record RSS Failures' and 'Record Reddit Failures' are gone — every fetch
// node's error output now converges on 'Shape Fetch Failure' -> 'Record Fetch
// Failures' (see FETCH_NODES and the connections section below), one table
// instead of a per-branch one that only RSS and Reddit ever got.
const INGESTION = [
  'Monday 6 AM Trigger', 'Manual Dry Run Trigger', 'Set dryRun false', 'Set dryRun true',
  'Initialize Run', 'Load RSS Sources', 'RSS Read',
  'Normalize RSS Item', 'Load Reddit Sources', 'Reddit RSS Read',
  'Normalize Reddit Item', 'Load Customer Banks (Tier A)', 'Customer Google News',
  'Normalize Customer Item', 'PR Newswire Feed', 'Match PR Newswire to Customers',
  'Load Competitor Watchlist', 'Competitor Google News', 'Normalize Competitor Item',
  'Load AI Research Sources', 'AI Research Feed Read', 'Normalize AI Research Item',
  'Merge All Sources'
];
const INGESTION_SHIFT = {};

// Everything from Generate HTML on: rendering, persistence, delivery.
const DELIVERY = [
  'Generate HTML', 'Record Structured Content', 'Record Full HTML',
  'Record Edition Metadata', 'If Dry Run', 'Dry Run Stop',
  'Convert HTML to JSON for PDF', 'Generate PDF', 'Send email', 'Upload file'
];

// Delivery sat at x=4992 in v3 because 24 nodes of LLM plumbing preceded it.
// The replacement stage ends at x=1632, so pull the tail back.
const DELIVERY_X_SHIFT = 1856 - 4992;

const take = (name, shift = 0) => {
  const n = legacyByName.get(name);
  if (!n) throw new Error(`v3 workflow has no node named "${name}"`);
  return { ...n, position: [n.position[0] + shift, n.position[1]] };
};

// Code nodes whose bodies live in node-code/, refreshed on every build.
const CODE_OVERRIDES = {
  'Initialize Run': 'initialize-run.js',
  'Load RSS Sources': 'load-rss-sources.js',
  'Load Customer Banks (Tier A)': 'load-customer-banks.js',
  'Load Competitor Watchlist': 'load-competitor-watchlist.js',
  'Load Reddit Sources': 'load-reddit-sources.js',
  'Load AI Research Sources': 'load-ai-research-sources.js',
  'Normalize RSS Item': 'normalize-rss-item.js',
  'Normalize Reddit Item': 'normalize-reddit-item.js',
  'Normalize Customer Item': 'normalize-customer-item.js',
  'Normalize Competitor Item': 'normalize-competitor-item.js',
  'Normalize AI Research Item': 'normalize-ai-research-item.js',
  'Match PR Newswire to Customers': 'match-pr-newswire-to-customers.js'
};

// Supabase node builder — mirrors 'Record RSS Failures' / the 'Record ...'
// nodes in DELIVERY: tableId + autoMapInputData, no `credentials` key (set
// manually after import, same as the Anthropic model nodes).
const supabaseNode = (name, tableId, position) => ({
  parameters: { tableId, dataToSend: 'autoMapInputData' },
  id: nextId(),
  name,
  type: 'n8n-nodes-base.supabase',
  typeVersion: 1,
  position
});

// Every fetch node in ingestion is now an HTTP Request node with the same
// shape: a real User-Agent (n8n's default gets Cloudflare-walled and Reddit-
// throttled alike), Response Format fixed to Text (every Normalize* node
// parses the feed itself now — see shared/pool-helpers.js's parseFeedEntries),
// and a batch interval so a branch that fans out to many hosts (RSS, 30
// sources as of the 2026-09-24 SME coverage patch) or repeatedly hits one host (Google News, once per bank/vendor/AI
// query) does not look like a burst to whatever is on the other end.
// Continues to its error output on failure, which converges on 'Shape Fetch
// Failure' -> 'Record Fetch Failures' — see the connections section.
const UA = 'BackbaseInsights/1.0 (n8n newsletter ingestion; +https://backbase.com)';

function httpFetchParams(batchSize, batchIntervalMs) {
  return {
    url: '={{ $json.url }}',
    sendHeaders: true,
    headerParameters: { parameters: [{ name: 'User-Agent', value: UA }] },
    options: {
      response: { response: { responseFormat: 'text' } },
      batching: { batch: { batchSize, batchInterval: batchIntervalMs } }
    }
  };
}

// name -> { newName, batchSize, batchIntervalMs, maxTries, waitBetweenTries, notes }
const FETCH_NODES = {
  'RSS Read': {
    newName: 'RSS Fetch',
    batchSize: 2,
    batchIntervalMs: 3000,
    maxTries: 2,
    waitBetweenTries: 15000,
    notes:
      'One request per rss-sources.json source (30 as of the 2026-09-24 SME ' +
      'coverage patch; was 28 at the Sept 2026 audit): some ' +
      'direct feeds, some Google News fallbacks for the ones behind a Cloudflare wall ' +
      '(see that registry\u2019s per-source notes for which). Response format MUST stay ' +
      'Text \u2014 Normalize RSS Item parses every feed itself via parseFeedEntries, since ' +
      'the branch mixes RSS 2.0 and Atom and needs one parser shape for both. Spread ' +
      'across ~30 different hosts, so batching here is politeness rather than a fix for ' +
      'a specific 429 the way Reddit\u2019s is.'
  },
  // Reddit is deliberately absent from this map — as of v4 it is no longer an
  // HTTP Request node at all (native RSS Feed Read instead, wrapped in a
  // Loop Over Items + Wait pair), so it does not fit httpFetchParams' shape.
  // See the REDDIT_* node builders and splices below FETCH_NODES.
  'Customer Google News': {
    newName: 'Customer Google News',
    batchSize: 3,
    batchIntervalMs: 2000,
    maxTries: 2,
    waitBetweenTries: 10000,
    notes:
      'One Google News query per Tier A bank (31). load-customer-banks.js builds the ' +
      'full URL, including the banking/product qualifier, negative terms and when:7d ' +
      '\u2014 this node just fetches whatever url it is given. Response format MUST stay ' +
      'Text \u2014 Normalize Customer Item parses the feed itself, the same as every other ' +
      'branch now.'
  },
  'Competitor Google News': {
    newName: 'Competitor Google News',
    batchSize: 3,
    batchIntervalMs: 2000,
    maxTries: 2,
    waitBetweenTries: 10000,
    notes:
      'One Google News query per tracked vendor (see competitor-watch.json). Response ' +
      'format MUST stay Text \u2014 Normalize Competitor Item parses the feed itself.'
  },
  'AI Research Feed Read': {
    newName: 'AI Research Fetch',
    batchSize: 3,
    batchIntervalMs: 2000,
    maxTries: 2,
    waitBetweenTries: 10000,
    notes:
      'Mix of direct tech-press feeds and targeted Google News queries \u2014 see ' +
      'ai-research-sources.json. Response format MUST stay Text \u2014 Normalize AI Research ' +
      'Item parses the feed itself and applies the relevance-lens gate only to the ' +
      'direct feeds (origin: \'general\'), not the targeted queries.'
  },
  'PR Newswire Feed': {
    newName: 'PR Newswire Fetch',
    batchSize: 1,
    batchIntervalMs: 0,
    maxTries: 2,
    waitBetweenTries: 10000,
    notes:
      'One fixed feed, filtered against the full Tier A + Tier B roster downstream in ' +
      'Match PR Newswire to Customers. Response format MUST stay Text.'
  }
};

// Reddit Fetch's notes, kept out of FETCH_NODES since it no longer shares
// that map's httpFetchParams shape (native RSS Feed Read, not HTTP Request).
const REDDIT_FETCH_NOTES =
  'Native RSS Feed Read node \u2014 NOT an HTTP Request node, unlike every other fetch ' +
  'branch. v2/v3 used an HTTP Request node here so a custom User-Agent could be set ' +
  '(the native node cannot set headers at all); v4 switched back because the native ' +
  'node\u2019s hardcoded User-Agent (`rss-parser`) is a far more common, ordinary-feed-' +
  'reader string than the bespoke "BackbaseInsights/1.0 ... ingestion" one the HTTP ' +
  'node sent \u2014 which itself explicitly self-identifies as bot/ingestion traffic, ' +
  'exactly the shape a WAF is built to catch. See reddit-sources.json\u2019s ' +
  'access_method_history for the full version history, INCLUDING that the per-subreddit ' +
  'HTTP Request version (v3) still failed on every request \u2014 including r/banking, the ' +
  'one subreddit that had survived every prior version \u2014 which is why this is a node-' +
  'type change and not just another URL-shape tweak. Receives ONE subreddit at a time ' +
  'from \'Reddit Loop\' (Loop Over Items, batch size 1) \u2014 partly because this node has no ' +
  'batching/interval option of its own (the HTTP Request node did, and that spacing is ' +
  'what stops Reddit answering request 1 and refusing the other 15, measured under both ' +
  'v1 and v4), and partly because it only reliably processes the first item it is given. ' +
  'onError: continueRegularOutput + alwaysOutputData is load-bearing: an empty or failed ' +
  'subreddit still emits exactly one (empty) item, and the loop has nothing to re-trigger ' +
  'it with otherwise \u2014 the remaining subreddits would never get fetched. Output goes ' +
  'straight to \'Reddit Wait\' and back round the loop; nothing re-tags it on the way, ' +
  'because Normalize Reddit Item identifies each entry\u2019s subreddit from its /r/<sub>/ ' +
  'permalink instead of from a field an upstream node attached (see that node\u2019s header ' +
  'for why the tagger nodes that used to sit here were removed).';

const ingestion = INGESTION.map((name) => {
  const node = take(name, INGESTION_SHIFT[name] || 0);
  if (CODE_OVERRIDES[name]) {
    node.parameters = { ...node.parameters, jsCode: code(CODE_OVERRIDES[name]) };
  }
  if (name === 'Reddit RSS Read') {
    node.name = 'Reddit Fetch';
    node.type = 'n8n-nodes-base.rssFeedRead';
    node.typeVersion = 1.1;
    node.parameters = { url: '={{ $json.url }}', options: {} };
    node.notes = REDDIT_FETCH_NOTES;
    node.notesInFlow = true;
    // continueRegularOutput, not continueErrorOutput: with only one output to
    // wire, a failed subreddit follows the exact same path back into the loop
    // as an empty one, so there is no second branch that has to remember to
    // re-join the loop (forgetting to would strand every later subreddit).
    // The cost is that 'error' and 'empty' become indistinguishable per
    // subreddit — see normalize-reddit-item.js's event-status comment for why
    // that is acceptable and what still catches a real Reddit outage.
    node.onError = 'continueRegularOutput';
    node.alwaysOutputData = true;
    node.retryOnFail = true;
    node.maxTries = 2;
    node.waitBetweenTries = 5000;
    return node;
  }
  const fetchCfg = FETCH_NODES[name];
  if (fetchCfg) {
    node.name = fetchCfg.newName;
    node.type = 'n8n-nodes-base.httpRequest';
    node.typeVersion = 4.2;
    node.parameters = httpFetchParams(fetchCfg.batchSize, fetchCfg.batchIntervalMs);
    node.notes = fetchCfg.notes;
    node.notesInFlow = true;
    node.retryOnFail = true;
    node.maxTries = fetchCfg.maxTries;
    node.waitBetweenTries = fetchCfg.waitBetweenTries;
    delete node.executeOnce; // PR Newswire Feed had this; Load PR Newswire Source now emits exactly one item, so it is redundant.
  }
  return node;
});

// Brand-new nodes with no v3 equivalent — inserted by explicit splice rather
// than take(), since there is nothing to take() them from.
ingestion.splice(
  ingestion.findIndex((n) => n.name === 'PR Newswire Fetch'),
  0,
  codeNode('Load PR Newswire Source', 'load-pr-newswire-source.js', [-1728, 760])
);

// Reddit's fetch is a loop, not a single node: 'Reddit Loop' feeds 'Reddit
// Fetch' one subreddit at a time (batch size 1 — see loopNode's comment for
// why) and 'Reddit Wait' paces the loop before it feeds back into 'Reddit
// Loop'. Three nodes, no taggers: 'Tag Reddit Item'/'Tag Reddit Failure' used
// to sit between the fetch and the wait to stamp each entry's subreddit onto
// it, until it turned out the entries already carry it in their /r/<sub>/
// permalink — see normalize-reddit-item.js's header. See REDDIT_FETCH_NOTES
// and the connections section below for the full wiring.
const REDDIT_REGISTRY_WAIT_SECONDS = Math.round(
  (dataFile('../data/reddit-sources.json').collection_params.batch_interval_ms || 20000) / 1000
);
ingestion.splice(
  ingestion.findIndex((n) => n.name === 'Reddit Fetch'),
  0,
  loopNode('Reddit Loop', [-1504, 340])
);
ingestion.splice(
  ingestion.findIndex((n) => n.name === 'Reddit Fetch') + 1,
  0,
  waitNode('Reddit Wait', REDDIT_REGISTRY_WAIT_SECONDS, [-1056, 340])
);

ingestion.splice(
  ingestion.findIndex((n) => n.name === 'Normalize AI Research Item') + 1,
  0,
  codeNode('Shape Fetch Failure', 'shape-fetch-failure.js', [-1280, 1360]),
  supabaseNode('Record Fetch Failures', 'source_fetch_failures', [-1056, 1360])
);

const delivery = DELIVERY.map((name) => {
  const node = take(name, DELIVERY_X_SHIFT);
  if (name === 'Generate HTML') {
    node.parameters = { ...node.parameters, jsCode: code('generate-html.js') };
  }
  return node;
});

// ------------------------------------------------------------- LLM stage ----

const llmStage = [
  codeNode('Prepare Section Jobs', 'prepare-section-jobs.js', [288, 500]),
  chainNode(
    'Write Section',
    'write-section.md',
    [512, 500],
    'Writes Retail, Wealth, SME & Commercial, Employee and Banking AI.'
  ),
  codeNode('Guard + Assemble Sections', 'guard-section-links.js', [736, 500]),
  chainNode(
    'Write Executive Brief',
    'executive-brief.md',
    [960, 500],
    'Reads finished sections, not raw facts, so it can name cross-cutting themes.'
  ),
  codeNode('Assemble Newsletter JSON', 'assemble-newsletter-json.js', [1184, 500])
];

// Shared sub-nodes: one model for the three chains, one cheap model for the
// three parsers' auto-fix retries.
const subNodes = [
  modelNode('Claude Sonnet', MAIN_MODEL, 8000, [760, 940]),
  modelNode('Claude Haiku (JSON Fixer)', FIXER_MODEL, 8000, [1160, 940]),
  parserNode('Section Output Parser', 'write-section.schema.json', [560, 760]),
  parserNode('Brief Output Parser', 'executive-brief.schema.json', [1008, 760])
];

// ----------------------------------------------------------- connections ----

const main = (...targets) => ({
  main: [targets.map((node) => ({ node, type: 'main', index: 0 }))]
});

const connections = {};

// Ingestion and delivery wiring is unchanged, so lift it straight from v3 and
// drop the edges that pointed into the deleted middle.
const keptNames = new Set(
  [...INGESTION, ...DELIVERY].concat(llmStage.map((n) => n.name))
);
// 'PR Newswire Feed' used to be fetched directly off 'Initialize Run' — there
// was no Load node for a single fixed URL. Now that 'Load PR Newswire Source'
// exists (see FETCH_NODES / the ingestion splices above), it takes that slot
// instead, purely so PR Newswire's identity shape matches every other branch.
const RETARGET = { 'PR Newswire Feed': 'Load PR Newswire Source' };

for (const [from, conn] of Object.entries(legacy.connections)) {
  if (!keptNames.has(from)) continue;
  const filtered = {};
  for (const [type, outputs] of Object.entries(conn)) {
    filtered[type] = outputs.map((targets) =>
      (targets || [])
        .filter((t) => keptNames.has(t.node) || RETARGET[t.node])
        .map((t) => (RETARGET[t.node] ? { ...t, node: RETARGET[t.node] } : t))
    );
  }
  connections[from] = filtered;
}

// Renamed nodes no longer exist under their v3 name; their edges are
// redeclared below. 'Customer Google News' and 'Competitor Google News' kept
// their names but gained a second (error) output that v3 never wired to
// anything, so those two are redeclared as well rather than left as the
// single-array shape the legacy copy carried over.
for (const name of ['RSS Read', 'Reddit RSS Read', 'AI Research Feed Read', 'PR Newswire Feed']) {
  delete connections[name];
}

const errorTo = (parent) => ({
  main: [
    [{ node: parent, type: 'main', index: 0 }],
    [{ node: 'Shape Fetch Failure', type: 'main', index: 0 }]
  ]
});

Object.assign(connections, {
  'Load RSS Sources': main('RSS Fetch'),
  'RSS Fetch': errorTo('Normalize RSS Item'),

  // Reddit is a loop, not a single fetch node — see REDDIT_FETCH_NOTES.
  // 'Load Reddit Sources' feeds the loop's initial 16 items; 'Reddit Wait'
  // feeds it again on every subsequent iteration (a node can have more than
  // one thing wired into the same input — this is n8n's own documented
  // "Loop Over Items" pattern for driving a node that can't batch itself).
  'Load Reddit Sources': main('Reddit Loop'),
  'Reddit Loop': {
    main: [
      [{ node: 'Reddit Fetch', type: 'main', index: 0 }], // loop output: next subreddit
      [{ node: 'Normalize Reddit Item', type: 'main', index: 0 }] // done output: every subreddit processed
    ]
  },
  // One output only (onError: continueRegularOutput), so a failed subreddit
  // re-joins the loop by exactly the same edge an empty or successful one does.
  'Reddit Fetch': main('Reddit Wait'),
  'Reddit Wait': main('Reddit Loop'),

  'Customer Google News': errorTo('Normalize Customer Item'),
  'Competitor Google News': errorTo('Normalize Competitor Item'),

  'Load AI Research Sources': main('AI Research Fetch'),
  'AI Research Fetch': errorTo('Normalize AI Research Item'),

  'Load PR Newswire Source': main('PR Newswire Fetch'),
  'PR Newswire Fetch': errorTo('Match PR Newswire to Customers'),

  // Every fetch node's error output converges here — see FETCH_NODES above.
  // n8n fans this in as one execution per connected source, so
  // shape-fetch-failure.js always sees items from exactly one branch per run.
  'Shape Fetch Failure': main('Record Fetch Failures'),

  'Merge All Sources': main('Prepare Section Jobs'),
  'Prepare Section Jobs': main('Write Section'),
  'Write Section': main('Guard + Assemble Sections'),
  'Guard + Assemble Sections': main('Write Executive Brief'),
  'Write Executive Brief': main('Assemble Newsletter JSON'),
  'Assemble Newsletter JSON': main('Generate HTML'),

  // Sub-nodes connect FROM themselves TO their parent. One sub-node can feed
  // several parents; they stack in the same index-0 array.
  'Claude Sonnet': {
    ai_languageModel: [
      ['Write Section', 'Write Executive Brief'].map((node) => ({
        node,
        type: 'ai_languageModel',
        index: 0
      }))
    ]
  },
  'Claude Haiku (JSON Fixer)': {
    ai_languageModel: [
      ['Section Output Parser', 'Brief Output Parser'].map((node) => ({
        node,
        type: 'ai_languageModel',
        index: 0
      }))
    ]
  },
  'Section Output Parser': {
    ai_outputParser: [[{ node: 'Write Section', type: 'ai_outputParser', index: 0 }]]
  },
  'Brief Output Parser': {
    ai_outputParser: [[{ node: 'Write Executive Brief', type: 'ai_outputParser', index: 0 }]]
  }
});

// --------------------------------------------------------------- validate ---

const nodes = [...ingestion, ...llmStage, ...subNodes, ...delivery];
const names = new Set(nodes.map((n) => n.name));

const problems = [];
for (const n of nodes) {
  if (nodes.filter((o) => o.name === n.name).length > 1) problems.push(`duplicate node name: ${n.name}`);
}
for (const [from, conn] of Object.entries(connections)) {
  if (!names.has(from)) problems.push(`connection from unknown node: ${from}`);
  for (const outputs of Object.values(conn)) {
    for (const targets of outputs) {
      for (const t of targets || []) {
        if (!names.has(t.node)) problems.push(`${from} -> unknown node: ${t.node}`);
      }
    }
  }
}
// Every Code node's $('...') references must resolve to a node that exists.
for (const n of nodes) {
  if (n.type !== 'n8n-nodes-base.code') continue;
  for (const m of (n.parameters.jsCode || '').matchAll(/\$\(\s*'([^']+)'\s*\)/g)) {
    if (!names.has(m[1])) problems.push(`${n.name}: $('${m[1]}') refers to a node that does not exist`);
  }
}

// A node with onError: continueErrorOutput but only one wired output array
// silently drops every failure on the floor instead of routing it to Shape
// Fetch Failure — exactly the shape 'Customer Google News' and 'Competitor
// Google News' were in before this audit (v3 never wired their error
// output at all). Catch that class of bug at build time, not by noticing a
// branch's failures never appear anywhere.
for (const n of nodes) {
  if (n.onError !== 'continueErrorOutput') continue;
  const outputs = (connections[n.name] && connections[n.name].main) || [];
  if (outputs.length < 2 || !outputs[1] || outputs[1].length === 0) {
    problems.push(`${n.name}: onError is continueErrorOutput but its error output (index 1) is not wired to anything`);
  }
}

// The registries are the actual source of truth now (see @data in
// load-*.js) — a registry that resolves to zero active sources would build a
// workflow that silently fetches nothing from that branch.
const rssActive = dataFile('../data/rss-sources.json').sources.filter((s) => s.status !== 'quarantined');
if (rssActive.length === 0) problems.push('rss-sources.json has no active (non-quarantined) sources');
const customerTierA = dataFile('../data/customer-banks.json').banks.filter((b) => b.tier === 'A');
if (customerTierA.length === 0) problems.push('customer-banks.json has no Tier A banks');
const competitorCount =
  (dataFile('../data/competitor-watch.json').cross_cutting || []).length +
  Object.values(dataFile('../data/competitor-watch.json').by_lob || {}).reduce((n, l) => n + l.length, 0);
if (competitorCount === 0) problems.push('competitor-watch.json has no vendors');
const aiSourceCount =
  (dataFile('../data/ai-research-sources.json').general_ai_rss || []).length +
  (dataFile('../data/ai-research-sources.json').targeted_google_news_queries || []).length;
if (aiSourceCount === 0) problems.push('ai-research-sources.json has no sources');
const redditSubredditCount = (dataFile('../data/reddit-sources.json').subreddits || []).length;
if (redditSubredditCount === 0) problems.push('reddit-sources.json has no subreddits');

if (problems.length) {
  console.error('build failed:');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

// ------------------------------------------------------------------ emit ----

const workflow = {
  name: 'Backbase Insights 4.0',
  nodes,
  connections,
  pinData: {},
  active: false,
  settings: { executionOrder: 'v1' },
  meta: legacy.meta || {}
};

const json = JSON.stringify(workflow, null, 2) + '\n';

// Files under node-code/ are no longer safe to paste straight into n8n: any
// with an @include line need the build step to resolve it first, and pasting
// the raw source gives "hostOf is not defined". This prints one node's final
// body for when you are patching a single node by hand rather than re-importing.
// Writes every Code node's final body to paste/<Node Name>.js, for patching a
// running workflow node by node instead of re-importing. Generated output —
// gitignored, and safe to delete.
if (process.argv.includes('--emit-paste')) {
  const dir = join(here, 'paste');
  if (!existsSync(dir)) mkdirSync(dir);
  let n = 0;
  for (const node of nodes) {
    if (!node.parameters || !node.parameters.jsCode) continue;
    writeFileSync(join(dir, `${node.name}.js`), node.parameters.jsCode);
    n++;
  }
  console.log(`wrote ${n} node bodies to newsletter/n8n/paste/`);
  process.exit(0);
}

const nodeFlag = process.argv.indexOf('--node');
if (nodeFlag !== -1) {
  const wanted = process.argv[nodeFlag + 1];
  const hit = nodes.find((n) => n.name === wanted);
  if (!hit) {
    console.error(`no node named "${wanted}". Code nodes in this workflow:`);
    for (const n of nodes.filter((n) => n.parameters && n.parameters.jsCode)) {
      console.error('  ' + n.name);
    }
    process.exit(1);
  }
  if (!hit.parameters || !hit.parameters.jsCode) {
    console.error(`"${wanted}" is not a Code node`);
    process.exit(1);
  }
  // writeSync to fd 1, NOT process.stdout.write + process.exit(0). When stdout
  // is a pipe (any `$(...)` capture, or a test calling this via execFileSync)
  // that write is asynchronous, and process.exit does not wait for it to
  // drain — every node body here is bigger than a pipe buffer, so it arrived
  // truncated at ~8KB, mid-string, consistently. Pasting that into n8n gives a
  // syntax error whose cause is invisible from the paste. Printing to a
  // terminal masked it, because a TTY write is synchronous.
  writeSync(1, hit.parameters.jsCode);
  process.exit(0);
}

if (process.argv.includes('--check')) {
  const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
  if (current !== json) {
    console.error('backbase-insights-v4.json is stale — run: node newsletter/n8n/build-workflow.mjs');
    process.exit(1);
  }
  console.log('backbase-insights-v4.json is up to date');
  process.exit(0);
}

writeFileSync(outPath, json);
console.log(
  `wrote backbase-insights-v4.json — ${nodes.length} nodes ` +
    `(${ingestion.length} ingestion, ${llmStage.length} LLM stage, ${subNodes.length} sub-nodes, ${delivery.length} delivery)`
);
console.log('v3 had 64. Import the generated file in n8n, then set the Anthropic credential on both model nodes.');
