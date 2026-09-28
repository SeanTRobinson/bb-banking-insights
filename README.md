# Backbase Insights Newsletter — v4

Revitalization of the "Banking Insights 2.0" n8n workflow per the
[Backbase Insights Revitalization plan](../.cursor/plans/backbase_insights_revitalization_b7f8397d.plan.md).
External sources only — no internal Backbase systems are queried from this
personal n8n instance.

**Start with [`docs/handoff.md`](docs/handoff.md)** — what the workflow does, how to
import it, and how to change it.

## What's in here

| Path | Purpose |
|---|---|
| [`n8n/backbase-insights-v4.json`](n8n/backbase-insights-v4.json) | **Generated.** The importable n8n workflow. Never hand-edit — run `node n8n/build-workflow.mjs`. |
| [`n8n/build-workflow.mjs`](n8n/build-workflow.mjs) | Assembles the workflow JSON from the node code, prompts and schemas below. |
| [`n8n/backbase-insights-workflow.json`](n8n/backbase-insights-workflow.json) | v3, frozen. Rollback artefact and the source of the ingestion/delivery nodes v4 carries forward. |
| [`n8n/node-code/*.js`](n8n/node-code/) | Code node bodies, one file per node. |
| [`n8n/schemas/*.json`](n8n/schemas/) | JSON Schemas for the section and executive-summary parsers. |
| [`data/rss-sources.json`](data/rss-sources.json) | Tier 1 industry/regulatory RSS registry. |
| [`data/reddit-sources.json`](data/reddit-sources.json) | Tier 2 subreddit registry. |
| [`data/customer-banks.json`](data/customer-banks.json) | Tier 3 customer bank monitoring list (Tier A/B). |
| [`data/competitor-watch.json`](data/competitor-watch.json) | Competitor registry, overall + by LOB. |
| [`data/ai-research-sources.json`](data/ai-research-sources.json) | AI Research Radar sources + relevance lenses. |
| [`sql/schema.sql`](sql/schema.sql) | Supabase tables used by delivery and edition metadata. |
| [`prompts/write-section.md`](prompts/write-section.md) · [`prompts/executive-brief.md`](prompts/executive-brief.md) | The two live prompts. The build injects the marked blocks into the workflow JSON, so these are the source of truth. |
| [`prompts/phase*.md`](prompts/), [`prompts/repair-prompt.md`](prompts/repair-prompt.md) | v3 only. Superseded by the three above; kept while v3 is still the rollback. |
| [`docs/handoff.md`](docs/handoff.md) | Architecture, import steps, how to make changes, operating notes. |
| [`docs/implementation-guide.md`](docs/implementation-guide.md) | v3 setup walkthrough (Supabase, credentials, environment). Accurate for the one-time account and credential setup; its LLM stage and dedup nodes are superseded by the handoff doc. |

## Newsletter structure

1. **Executive Brief** — cross-cutting synthesis
2. **Retail**
3. **Wealth**
4. **SME & Commercial**
5. **Employee**
6. **Banking AI**

Employee facts are also supplied to every non-Employee section writer. The writer
interweaves directly relevant employee experience or appends a short employee note.

## Pipeline

```
sources ──► normalise ──► merge ──► deduplicate + route five sections
                                             │
                                             ▼
                                      Write Section
                                             │
                                             ▼
                              link guard ──► Executive Brief
                                             │
                                             ▼
                                  HTML ──► Supabase, PDF, email
```

## Start here

Read [`docs/handoff.md`](docs/handoff.md).
