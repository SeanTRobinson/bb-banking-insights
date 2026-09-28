# Backbase Insights v4 — handoff

## Workflow

The workflow intentionally has a small post-ingestion path:

```text
sources → normalise → Merge All Sources → Prepare Section Jobs
                                      → Write Section
                                      → Guard + Assemble Sections
                                      → Write Executive Brief
                                      → Assemble Newsletter JSON
                                      → Generate HTML
                                      → persist / PDF / email
```

`Prepare Section Jobs` is deterministic. It removes `_fetch_event` items, deduplicates
by canonical URL and normalised headline, and routes articles into:

- Retail
- Wealth
- SME & Commercial
- Employee
- Banking AI

Employee facts are included as context in every non-Employee job. `Write Section` must
weave relevant employee experience into the matching story, or append one concise
employee-experience note when no direct match exists.

There is no curator pass, coverage gate, scan-only branch, historical seen-article
ledger, section-repair loop, customer-only section, competitor-only section, or
community-only section. Customer and competitor developments appear in whichever of
the five editorial sections they affect.

## Reddit

Reddit uses one native RSS Feed Read request per subreddit:

```text
Load Reddit Sources → Reddit Loop → Reddit Fetch → Reddit Wait ┐
                          ▲                                    │
                          └────────────────────────────────────┘
                          │ done
                          ▼
                    Normalize Reddit Item
```

Keep the loop batch size at 1 and the wait at 20 seconds. Without spacing, Reddit
answers the first request and rejects most of the rest. The normalizer derives the
subreddit from each `/r/<sub>/` permalink; no tagger nodes are needed.

## Editing and importing

Source files:

- Code nodes: `n8n/node-code/*.js`
- LLM prompts: `prompts/write-section.md`, `prompts/executive-brief.md`
- Output schemas: `n8n/schemas/*.json`
- Source registries: `data/*.json`

Build and verify:

```bash
cd newsletter
node n8n/build-workflow.mjs
node n8n/build-workflow.mjs --emit-paste
node n8n/build-workflow.mjs --check
npm test
```

Import `n8n/backbase-insights-v4.json`, then select the Anthropic credential on the two
model nodes. For a single live-node patch, copy the matching file from `n8n/paste/`.

## Delivery

`Generate HTML` renders the executive brief and five sections. The existing delivery
tail persists structured content, HTML and edition metadata, then either stops for a
dry run or produces the PDF and sends/uploads it.
