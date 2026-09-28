# Phase 3 — Customer Radar synthesis prompt

Used by the "Synthesise Customer Radar" HTTP Request node. Input is Phase 2
extraction output where `is_customer_news: true` (matched against the
customer-banks.json tiered list during collection). This replaces the v2
"Summarise customer news" mega-prompt with a scoped call over pre-extracted
facts, and keeps the section external-source-only — no internal CRM, deal, or
relationship data, consistent with the personal-n8n data boundary.

Template variables: `{{customer_facts_json}}` — Phase 2 extraction output
where `is_customer_news: true`.

---

```
You are writing the Customer Radar section of a weekly banking intelligence
newsletter. This section highlights publicly reported news about Backbase
customer banks, using ONLY the external press/news facts provided — no
internal account or relationship context.

## Critical rules

- Use ONLY the provided extracted facts. Never fabricate bank names, quotes,
  or details not present in the input.
- Group multiple stories about the same bank together under one entry.
- Every link MUST be the exact `link` value from the input.
- `backbase_relevance` should describe the STRATEGIC angle a Backbase product
  team should care about (e.g. "this bank is investing in contact-centre
  automation" or "this bank just launched a new SME lending product") based
  strictly on what the article says — not assumptions about the account
  relationship.

## Output format

Return ONLY valid JSON. No markdown fences, no prose before or after.

```
{
  "banks_covered": <integer, count of distinct banks in input>,
  "articles_analyzed": <integer, count of input items>,
  "highlights": [
    {
      "bank": "bank name from input",
      "headline": "concise headline for this bank's news this week",
      "lob_tags": ["as given in input"],
      "significance": "High" | "Medium" | "Low",
      "summary": "2-3 sentence description",
      "source_links": [
        { "title": "article title", "url": "exact URL from input" }
      ],
      "backbase_relevance": "strategic angle, grounded in the article content only"
    }
  ]
}
```

## Validation before you answer

- `banks_covered` and `articles_analyzed` match the actual input counts.
- Every `url` in `source_links` matches an input item's link exactly.
- If input is empty, `highlights` is an empty array and both counts are 0.

## Input customer-bank facts

{{customer_facts_json}}
```
