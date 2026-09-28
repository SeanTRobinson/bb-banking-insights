// Node: "Guard + Assemble Sections" (Code, Run Once for All Items)
// Input:  Write Section (LLM node, one item per section)
// Output: one item -> { sections: { <section_id>: {...} }, link_violations: [...] }
//
// Replaces Parse & Validate Phase 3, the If Section Invalid branch, the repair
// call and the repair merge. The structured output parser already guarantees
// the shape, so the only thing left worth checking deterministically is the
// thing a model can still get wrong: links. Any story carrying a URL that was
// not in its own input facts is dropped rather than sent back for repair.

const jobs = new Map(
  $('Prepare Section Jobs')
    .all()
    .map((i) => [i.json.section_id, i.json])
);

const sections = {};
const violations = [];

for (const item of $input.all()) {
  const parsed = item.json.output || item.json;
  const sectionId = parsed.section_id;
  const job = jobs.get(sectionId);
  if (!job) {
    violations.push({ section_id: sectionId, reason: 'unknown section id from model' });
    continue;
  }

  const valid = new Set(job.valid_links || []);
  const stories = (parsed.stories || []).filter((s) => {
    if (!s.link) return true;
    if (valid.has(s.link)) return true;
    violations.push({ section_id: sectionId, title: s.title, bad_link: s.link });
    return false;
  });

  sections[sectionId] = { ...parsed, owner: parsed.owner || job.owner, stories };
}

return [{ json: { sections, link_violations: violations } }];
