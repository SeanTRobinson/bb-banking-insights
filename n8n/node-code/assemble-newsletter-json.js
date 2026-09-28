// Node: "Assemble Newsletter JSON" (Code, Run Once for All Items)
// Input:  Write Executive Brief
// Output: one item -> Generate HTML
//
// Pulls sections and brief by node name rather than through a Merge node, so
// the LLM stage stays a straight line on the canvas.

const run = $('Initialize Run').first().json;
const guard = $('Guard + Assemble Sections').first().json;
const sections = guard.sections || {};
const brief = ($input.first().json.output) || {};
const jobs = $('Prepare Section Jobs').all().map((i) => i.json);
const counts = jobs[0] || {};

return [
  {
    json: {
      run_id: run.run_id,
      edition_date: run.edition_date,
      week_start: run.week_start,
      week_end: run.week_end,
      // edition_metadata.mode is NOT NULL with a three-value check constraint.
      // v4 dropped the triage_only / keyword_only branches for a hard pool cap,
      // so every edition is now 'full'.
      mode: 'full',
      dry_run: run.dry_run,
      executive_summary: brief,
      sme_commercial: sections.sme_commercial || {},
      wealth: sections.wealth || {},
      retail: sections.retail || {},
      employee: sections.employee || {},
      banking_ai: sections.banking_ai || {},
      processing_metadata: {
        articles_collected: counts.articles_collected || 0,
        articles_after_dedup: counts.articles_after_dedup || 0,
        section_jobs: jobs.length,
        articles_published: Object.values(sections)
          .reduce((n, section) => n + ((section.stories || []).length), 0),
        link_violations: guard.link_violations || [],
        next_report: run.week_end
      }
    }
  }
];
