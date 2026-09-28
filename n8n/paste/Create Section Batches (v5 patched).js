const SECTIONS = {
  retail: { title: 'Retail', owner: 'Thomas', cap: 18 },
  wealth: { title: 'Wealth', owner: 'Lennart', cap: 18 },
  sme_commercial: { title: 'SME & Commercial', owner: 'Jarno', cap: 18 },
  employee: { title: 'Employee', owner: 'Sam', cap: 20 },
  banking_ai: { title: 'Banking AI', owner: '', cap: 18 },
  customers: { title: 'Customers', owner: '', cap: 16 },
  competitors: { title: 'Competitors', owner: '', cap: 16 }
};

// Sections below this count get a loud warning in the execution log instead
// of shipping silently — "no SME/commercial news this week" should be
// something you notice from the log, not something you have to spot by
// reading the finished newsletter. Added 2026-09-24 after a zero-story
// SME & Commercial edition.
const COVERAGE_FLOOR = 3;
const GATED_SECTIONS = ['retail', 'wealth', 'sme_commercial', 'employee', 'banking_ai'];

const EMPLOYEE_SUBREDDITS = new Set([
  'financialcareers',
  'callcentres',
  'customerservice',
  'talesfromcallcenters'
]);

const now = new Date();
const weekEnd = now.toISOString().slice(0, 10);
const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

function newestFirst(a, b) {
  return Date.parse(b.published_date || 0) - Date.parse(a.published_date || 0);
}

function isEmployee(article, tags, text) {
  if (tags.includes('digital_assist') || tags.includes('employee')) return true;

  const match = /reddit\.com\/r\/([^/]+)/i.exec(article.link || '');
  if (match && EMPLOYEE_SUBREDDITS.has(match[1].toLowerCase())) return true;

  return /\b(contact|call) cent(?:re|er)|agent desktop|bank employee|branch staff|teller|service agent|workforce management\b/i.test(text);
}

// customer_name is only ever stamped by the customer ingest branches, which
// match against newsletter/data/customer-banks.json. That name IS the roster
// check. Do not also require source_key to still say 'customer:...' — after
// de-dup the surviving copy of a story can legitimately come from an industry
// feed while keeping the customer identity.
function isRosterCustomer(article) {
  const name = String(article.customer_name || '').trim();
  return Boolean(
    name &&
    (article.is_customer_news === true ||
      article.source_type === 'customer_news' ||
      String(article.source_key || '').startsWith('customer:'))
  );
}

function isTrackedCompetitor(article) {
  const name = String(article.competitor_name || '').trim();
  return Boolean(
    name &&
    (article.is_competitive === true ||
      article.source_type === 'competitor' ||
      String(article.source_key || '').startsWith('competitor:'))
  );
}

function fact(article) {
  return {
    id: article.id || '',
    title: String(article.title || '').slice(0, 300),
    date: article.published_iso || String(article.published_date || '').slice(0, 40),
    source: article.source_name || '',
    source_type: article.source_type || '',
    link: article.link || '',
    content: String(article.content || '').replace(/\s+/g, ' ').slice(0, 1800),
    customer_name: article.customer_name || '',
    competitor_name: article.competitor_name || ''
  };
}

const articles = $input.all().map((item) => item.json || {});
const buckets = new Map(Object.keys(SECTIONS).map((id) => [id, []]));

for (const article of articles) {
  const tags = Array.isArray(article.lob_tags) ? article.lob_tags : [];
  const text = (article.title || '') + ' ' + (article.content || '');

  if (tags.includes('retail')) buckets.get('retail').push(article);
  if (tags.includes('wealth')) buckets.get('wealth').push(article);
  if (tags.includes('sme_commercial')) buckets.get('sme_commercial').push(article);
  if (isEmployee(article, tags, text)) buckets.get('employee').push(article);
  if (
    article.ai_research ||
    article.source_type === 'ai_research' ||
    tags.includes('banking_ai')
  ) {
    buckets.get('banking_ai').push(article);
  }
  if (isRosterCustomer(article)) buckets.get('customers').push(article);
  if (isTrackedCompetitor(article)) buckets.get('competitors').push(article);
}

const employeeFacts = buckets
  .get('employee')
  .slice()
  .sort(newestFirst)
  .slice(0, SECTIONS.employee.cap);

const jobs = [];

for (const [sectionId, meta] of Object.entries(SECTIONS)) {
  let selected = buckets.get(sectionId).slice().sort(newestFirst);

  if (sectionId === 'customers' || sectionId === 'competitors') {
    const keyField = sectionId === 'customers' ? 'customer_name' : 'competitor_name';
    const byName = new Map();
    for (const article of selected) {
      const name = article[keyField];
      if (!byName.has(name)) byName.set(name, article);
    }
    selected = [...byName.values()].slice(0, meta.cap);
  } else {
    selected = selected.slice(0, meta.cap);
  }

  if (!selected.length) continue;

  const employeeContext = sectionId === 'employee' ? [] : employeeFacts;

  jobs.push({
    json: {
      week_start: weekStart,
      week_end: weekEnd,
      section_id: sectionId,
      section_title: meta.title,
      owner: meta.owner,
      fact_count: selected.length,
      facts_json: JSON.stringify(selected.map(fact)),
      employee_fact_count: employeeContext.length,
      employee_facts_json: JSON.stringify(employeeContext.map(fact)),
      valid_links: selected.concat(employeeContext).map((a) => a.link).filter(Boolean)
    }
  });
}

const namedCustomers = articles.filter((a) => String(a.customer_name || '').trim()).length;
const flaggedCustomers = articles.filter((a) => a.is_customer_news === true).length;
const typedCustomers = articles.filter((a) => a.source_type === 'customer_news').length;

console.log(
  '[sections] pool=' + articles.length +
  ' retail=' + buckets.get('retail').length +
  ' wealth=' + buckets.get('wealth').length +
  ' sme_commercial=' + buckets.get('sme_commercial').length +
  ' employee=' + buckets.get('employee').length +
  ' banking_ai=' + buckets.get('banking_ai').length +
  ' customers=' + buckets.get('customers').length +
  ' competitors=' + buckets.get('competitors').length +
  ' jobs=' + jobs.length +
  ' | customer_name=' + namedCustomers +
  ' is_customer_news=' + flaggedCustomers +
  ' source_type=customer_news=' + typedCustomers
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

return jobs;
