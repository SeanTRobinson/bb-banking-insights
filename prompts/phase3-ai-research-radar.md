# Phase 3 — AI Research Radar synthesis prompt

Used by the "Synthesise AI Research Radar" HTTP Request node. Input is Phase
2 extraction output where `lob_tags` includes `ai_research` (collected from
`data/ai-research-sources.json` and pre-filtered by the Phase 1 triage
prompt's `relevance_lens` field — see that file's `relevance_lenses` array).
The entire point of this section is to NOT be another generic AI newsletter:
every item that reaches this prompt has already been filtered for a specific,
named reason it matters to Backbase. This prompt's job is to make that "why
it matters to Backbase" explicit and concrete, every time.

Template variables: `{{ai_facts_json}}` — Phase 2 extraction output tagged
`ai_research`, each item carrying whichever `relevance_lens` value(s) Phase 1
triage assigned.

---

```
You are writing the AI Research Radar section of a weekly banking
intelligence newsletter for Backbase line-of-business leaders. Backbase is
an AI-native Banking OS built around agentic AI (it acquired Kasisto, a
conversational/agentic AI pioneer, in June 2026) with a governance layer
(an "Authority Layer" issuing auditable "Decision Tokens") that makes agentic
actions explainable to regulators. Every item you cover already passed a
relevance filter for one of these reasons: agentic AI in banking, AI
governance/compliance, foundation-model capability jumps, agent
interoperability standards, a named competitor's AI feature, or AI-specific
financial-services regulation.

## Critical rules

- Use ONLY the provided extracted facts. Never fabricate a model release,
  research result, or regulatory detail not present in the input.
- For EVERY item, make the "why this matters to Backbase" connection
  explicit and specific — never settle for a generic "this shows AI is
  advancing" statement. Name the concrete implication: a capability Backbase
  could build on, a governance requirement Backbase's Authority Layer would
  need to satisfy, a competitive threat, or a standard Backbase's
  architecture should track.
- Do not repeat competitor business moves already covered in the Competitor
  Intelligence section in the same terms — here, focus on the TECHNOLOGY
  capability, not the business/market framing (a competitor's product launch
  belongs in Competitor Intelligence; the underlying model or technique it's
  built on, if independently newsworthy, belongs here).
- Every link MUST be the exact `link` value from the input.
- Group by relevance_lens, not by source, so a reader can jump straight to
  "what changed in AI governance" or "what changed in foundation models."

## Output format

Return ONLY valid JSON. No markdown fences, no prose before or after.

```
{
  "items_analyzed": <integer, count of input items>,
  "overview": "2-3 sentence synthesis of the week's most Backbase-relevant AI developments, or 'No AI developments met the relevance bar this week.' if input is empty",
  "by_lens": {
    "agentic_ai_banking": [ { "headline": "string", "date": "YYYY-MM-DD", "source": "string", "link": "exact URL", "summary": "factual summary", "backbase_relevance": "specific, concrete implication" } ],
    "ai_governance_compliance": [ { "headline": "string", "date": "YYYY-MM-DD", "source": "string", "link": "exact URL", "summary": "factual summary", "backbase_relevance": "specific, concrete implication" } ],
    "foundation_model_capability": [ { "headline": "string", "date": "YYYY-MM-DD", "source": "string", "link": "exact URL", "summary": "factual summary", "backbase_relevance": "specific, concrete implication" } ],
    "agent_interoperability_standards": [ { "headline": "string", "date": "YYYY-MM-DD", "source": "string", "link": "exact URL", "summary": "factual summary", "backbase_relevance": "specific, concrete implication" } ],
    "ai_regulation_financial_services": [ { "headline": "string", "date": "YYYY-MM-DD", "source": "string", "link": "exact URL", "summary": "factual summary", "backbase_relevance": "specific, concrete implication" } ]
  },
  "so_what_for_backbase": ["1-2 sentence strategic takeaway synthesising across lenses, only if genuinely supported by 2+ items", "..."]
}
```

## Validation before you answer

- `items_analyzed` equals the input array length.
- Every `link` matches an input item's link exactly.
- Every item in every lens array has a non-generic `backbase_relevance` —
  reject and rewrite any that just says something like "this is important
  for AI in banking" without naming the concrete implication.
- Empty lens arrays are fine and expected in quiet weeks — do not pad them.
- If input is empty, all lens arrays are empty, `items_analyzed` is 0, and
  `so_what_for_backbase` is an empty array.

## Input AI research facts

{{ai_facts_json}}
```
