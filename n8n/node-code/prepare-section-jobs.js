// Node: "Prepare Section Jobs" (Code, Run Once for All Items)
// Input: Merge All Sources
// Output: one job for each non-empty newsletter section.
//
// This is the complete deterministic post-ingestion stage: remove fetch
// markers, deduplicate this run, route articles into the five newsletter
// sections, cap each section, and attach employee context to every other
// section. The LLM writes; it does not classify or deduplicate.

const SECTIONS = {
  retail: { title: 'Retail', owner: 'Thomas Silverberg', cap: 18 },
  wealth: { title: 'Wealth', owner: 'Lennart', cap: 18 },
  sme_commercial: { title: 'SME & Commercial', owner: 'Jarno', cap: 18 },
  employee: { title: 'Employee', owner: 'Sam Hartrey', cap: 20 },
  banking_ai: { title: 'Banking AI', owner: '', cap: 18 }
};

const EMPLOYEE_SUBREDDITS = new Set([
  'financialcareers',
  'callcentres',
  'customerservice',
  'talesfromcallcenters'
]);

const DROP_PARAM = /^(utm_[a-z]+|gclid|fbclid|ref|oc|hl|gl|ceid|at_medium|at_campaign)$/i;

function canonicalize(url) {
  if (!url) return '';
  let s = String(url).trim().replace(/^https?:\/\//i, '').split('#')[0];
  const q = s.indexOf('?');
  let path = q === -1 ? s : s.slice(0, q);
  let query = q === -1 ? '' : s.slice(q + 1);
  path = path.replace(/\/+$/, '').replace(/\/{2,}/g, '/');
  const slash = path.indexOf('/');
  const host = (slash === -1 ? path : path.slice(0, slash))
    .toLowerCase()
    .replace(/^www\./, '');
  const rest = slash === -1 ? '' : path.slice(slash);
  query = query
    .split('&')
    .filter((pair) => pair && !DROP_PARAM.test(pair.split('=')[0]))
    .sort()
    .join('&');
  return host + rest + (query ? '?' + query : '');
}

function normalTitle(title) {
  return String(title || '')
    .replace(/\s+[-–|]\s+[^-–|]{2,50}$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function score(a) {
  const host = String(a.link || '').toLowerCase();
  const aggregator = /news\.google\.|prnewswire\.|businesswire\.|globenewswire\./.test(host);
  return String(a.content || '').length + (aggregator ? 0 : 5000);
}

function mergeCopies(a, b) {
  const winner = score(b) > score(a) ? b : a;
  const other = winner === a ? b : a;
  return {
    ...winner,
    // Routing evidence belongs to the story, not only to the copy whose body
    // won. A competitor query and an AI query can surface the same URL with
    // different tags; dropping the loser's tags would lose a valid section.
    lob_tags: [...new Set([...(a.lob_tags || []), ...(b.lob_tags || [])])],
    ai_research: Boolean(a.ai_research || b.ai_research),
    is_customer_news: Boolean(a.is_customer_news || b.is_customer_news),
    is_competitive: Boolean(a.is_competitive || b.is_competitive),
    customer_name: winner.customer_name || other.customer_name || '',
    competitor_name: winner.competitor_name || other.competitor_name || ''
  };
}

const input = $input.all()
  .map((item) => item.json || {})
  .filter((a) => !a._fetch_event && a.title && a.link);

// One winner per canonical URL, then one winner per normalised headline.
const byUrl = new Map();
for (const a of input) {
  const key = canonicalize(a.link);
  const existing = byUrl.get(key);
  byUrl.set(key, existing ? mergeCopies(existing, a) : a);
}

const byTitle = new Map();
for (const a of byUrl.values()) {
  const key = normalTitle(a.title);
  // Never merge records on an empty title key.
  if (!key) {
    byTitle.set('untitled:' + canonicalize(a.link), a);
    continue;
  }
  const existing = byTitle.get(key);
  byTitle.set(key, existing ? mergeCopies(existing, a) : a);
}

const deduped = [...byTitle.values()];
const buckets = new Map(Object.keys(SECTIONS).map((id) => [id, []]));

function isEmployee(a, tags, text) {
  if (tags.includes('digital_assist') || tags.includes('employee')) return true;
  const m = /reddit\.com\/r\/([^/]+)/i.exec(a.link || '');
  if (m && EMPLOYEE_SUBREDDITS.has(m[1].toLowerCase())) return true;
  return /\b(contact|call) cent(?:re|er)|agent desktop|bank employee|branch staff|teller|service agent|workforce management\b/i.test(text);
}

for (const a of deduped) {
  const tags = Array.isArray(a.lob_tags) ? a.lob_tags : [];
  const text = (a.title || '') + ' ' + (a.content || '');

  if (tags.includes('retail')) buckets.get('retail').push(a);
  if (tags.includes('wealth')) buckets.get('wealth').push(a);
  if (tags.includes('sme_commercial')) buckets.get('sme_commercial').push(a);
  if (isEmployee(a, tags, text)) buckets.get('employee').push(a);
  if (a.ai_research || a.source_type === 'ai_research' || tags.includes('banking_ai')) {
    buckets.get('banking_ai').push(a);
  }
}

function newestFirst(a, b) {
  return new Date(b.published_date || 0).getTime() - new Date(a.published_date || 0).getTime();
}

function fact(a) {
  return {
    title: String(a.title || '').slice(0, 300),
    date: String(a.published_date || '').slice(0, 40),
    source: a.source_name || '',
    source_type: a.source_type || '',
    link: a.link || '',
    content: String(a.content || '').replace(/\s+/g, ' ').slice(0, 2200),
    customer_name: a.customer_name || '',
    competitor_name: a.competitor_name || ''
  };
}

const employeeFacts = buckets.get('employee').sort(newestFirst).slice(0, SECTIONS.employee.cap);
const run = $('Initialize Run').first().json;
const out = [];

for (const [sectionId, meta] of Object.entries(SECTIONS)) {
  const facts = buckets.get(sectionId).sort(newestFirst).slice(0, meta.cap);
  if (!facts.length) continue;

  out.push({
    json: {
      run_id: run.run_id,
      week_start: run.week_start,
      week_end: run.week_end,
      section_id: sectionId,
      section_title: meta.title,
      owner: meta.owner,
      fact_count: facts.length,
      facts_json: JSON.stringify(facts.map(fact)),
      employee_fact_count: sectionId === 'employee' ? 0 : employeeFacts.length,
      employee_facts_json: sectionId === 'employee' ? '[]' : JSON.stringify(employeeFacts.map(fact)),
      valid_links: facts.concat(sectionId === 'employee' ? [] : employeeFacts)
        .map((a) => a.link)
        .filter(Boolean),
      articles_collected: input.length,
      articles_after_dedup: deduped.length
    }
  });
}

// Sections below this count get a loud warning in the execution log instead
// of shipping silently — "no SME/commercial news this week" should be
// something you notice from the log, not something you have to spot by
// reading the finished newsletter. Added 2026-09-24 after a zero-story SME
// & Commercial edition. Lives here (Prepare Section Jobs) rather than in a
// Create Section Batches node — that canvas name is the live n8n export;
// this file is the repo source that build-workflow.mjs inlines.
const COVERAGE_FLOOR = 3;
const GATED_SECTIONS = ['retail', 'wealth', 'sme_commercial', 'employee', 'banking_ai'];

console.log(
  '[sections] collected=' + input.length +
  ' deduped=' + deduped.length +
  ' retail=' + buckets.get('retail').length +
  ' wealth=' + buckets.get('wealth').length +
  ' sme_commercial=' + buckets.get('sme_commercial').length +
  ' employee=' + buckets.get('employee').length +
  ' banking_ai=' + buckets.get('banking_ai').length +
  ' jobs=' + out.length
);

const thin = GATED_SECTIONS
  .map((id) => ({ id, count: buckets.get(id).length }))
  .filter((b) => b.count < COVERAGE_FLOOR);

if (thin.length) {
  console.warn(
    '[coverage-gate] sections below floor (' + COVERAGE_FLOOR + '): ' +
    thin.map((b) => b.id + '=' + b.count).join(', ')
  );
}

return out;
