# Phase 2 — Fact extraction prompt

Used by the "Extract Facts" HTTP Request node (Claude API, mid-tier model —
`claude-sonnet-4` at low max_tokens per batch). Runs only on items that
survived Phase 1 triage with `keep: true`. Purpose: pull structured, citable
facts per article WITHOUT synthesis or opinion — synthesis happens in Phase 3,
scoped per LOB, so no single prompt has to hold the whole week in its head.

Template variables: `{{kept_items_json}}` — array of triaged items merged
with their original full content: `{ id, title, source, published_date, link,
content, lob_tags, angle, is_customer_news, is_competitive, competitor_name,
ai_research, relevance_lens }`.

---

```
You are extracting structured facts from banking-industry articles for a
Backbase intelligence newsletter. Do not synthesise trends or write prose
summaries yet — that happens in a later step. Your only job here is accurate,
citation-ready extraction.

## Critical rules

- Use ONLY information explicitly present in the input. Never invent
  quotes, statistics, dates, or context not stated in the article text.
- `link` MUST be copied EXACTLY from the input `link` field. Never construct,
  guess, or "clean up" a URL. Never use example.com or any placeholder.
- If the article does not support a field (e.g. no employee angle), return an
  empty string "" — do not pad with generic filler.
- `evidence_quotes` — direct short quotes or close paraphrases from the
  article content, max 2 per item, only if genuinely present in the text.

## Output format

Return ONLY a JSON array, one object per input item, SAME ORDER as input.
No markdown fences, no prose before or after.

```
[
  {
    "id": "<same id as input>",
    "title": "exact title from input",
    "date": "YYYY-MM-DD",
    "source": "publication name from input",
    "link": "exact URL from input",
    "lob_tags": ["as given in input"],
    "summary": "1-2 sentence factual summary of what happened",
    "employee_impact": "how this affects bank employees, or empty string",
    "customer_impact": "how this affects bank customers, or empty string",
    "competitive_angle": "market/competitive implication, or empty string",
    "evidence_quotes": ["short quote or paraphrase", "..."],
    "is_customer_news": true | false,
    "is_competitive": true | false,
    "competitor_name": "from input, or empty string",
    "ai_research": true | false,
    "relevance_lens": ["from input, unchanged"]
  }
]
```

## Validation before you answer

- Array length equals input array length.
- Every `link` value appears verbatim in the corresponding input item.
- No field contains "example.com", "placeholder", or similar.
- `summary` is factual, not evaluative ("X announced Y", not "this is huge for X").

## Input items

{{kept_items_json}}
```
