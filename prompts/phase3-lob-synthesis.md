# Phase 3 — LOB synthesis prompt (templated)

Used by the "Synthesise LOB" HTTP Request node, called ONCE PER LOB (SME &
Commercial, Wealth, Retail, Digital Assist) with only that LOB's extracted
facts as input. Running one call per LOB — instead of one mega-prompt across
all categories, as the v2 workflow did — is the direct fix for the "only 1
story per category made it into the newsletter" failure mode from the
original build: each LOB gets the full model's attention and its own token
budget, so a slow news week for Wealth can't crowd out a busy week for Retail.

Template variables:
- `{{lob_name}}` — "SME & Commercial", "Wealth", "Retail", or "Digital Assist"
- `{{lob_owner}}` — "Jarno", "Lennart", "Thomas Silverberg", or "Sam Hartrey"
- `{{lob_facts_json}}` — array of Phase 2 extraction output filtered to this
  LOB's tag
- `{{ex_facts_json}}` — array of Phase 2 items tagged `digital_assist` OR
  with `employee_impact` non-empty, filtered to THIS LOB, for the
  "employee experience in this segment" mini-block (empty array for the
  Digital Assist call itself, which gets its own full EX section instead)

---

```
You are writing the {{lob_name}} section of a weekly banking intelligence
newsletter for {{lob_owner}}, who leads {{lob_name}} at Backbase. This section
must let them understand in under two minutes what happened in their segment
this week and why it matters to their roadmap.

## Critical rules

- Base every claim ONLY on the provided extracted facts. Do not add outside
  knowledge, speculation, or general banking-industry commentary not tied to
  a specific input item.
- Every story you reference MUST use the exact `link` value from the input.
  Never fabricate or modify a link.
- Include ALL input items that are genuinely relevant — do not cherry-pick
  one or two examples and drop the rest. If there are 8 relevant items,
  include up to 8 (cap at 8; rank by strategic significance if there are
  more).
- If the input array is empty, say so plainly — do not manufacture content.
- Write in the second person where natural ("you'll want to watch...") but
  keep it factual, not promotional.

## Output format

Return ONLY valid JSON. No markdown fences, no prose before or after.

```
{
  "lob": "{{lob_name}}",
  "owner": "{{lob_owner}}",
  "summary": "2-3 sentence synthesis of the week in this segment, or 'No significant {{lob_name}} developments this week.' if the input is empty",
  "trend_direction": "Positive" | "Negative" | "Neutral" | "Mixed",
  "key_themes": ["string", "..."],
  "stories": [
    {
      "title": "exact title from input",
      "date": "YYYY-MM-DD",
      "source": "publication name",
      "link": "exact URL from input",
      "insight": "why this matters for {{lob_name}} strategy",
      "employee_impact": "from input, or empty string",
      "customer_impact": "from input, or empty string",
      "is_customer_news": true | false
    }
  ],
  "employee_experience_note": "1-2 sentence highlight of anything segment-specific to the employee/frontline experience in {{lob_name}} this week, drawn ONLY from {{ex_facts_json}} — or empty string if nothing specific",
  "strategic_questions": ["question {{lob_owner}} might want to raise this week", "..."]
}
```

## Validation before you answer

- `stories` includes every genuinely relevant input item (capped at 8, ranked
  by significance if more).
- Every `link` in `stories` matches an input item's link exactly.
- `employee_experience_note` is empty unless {{ex_facts_json}} actually
  contains something — do not pad it with a generic observation.
- `strategic_questions` has 2-4 items, specific to this week's actual news,
  not generic "how might AI transform banking" filler.

## LOB facts (this section's stories)

{{lob_facts_json}}

## Employee-experience facts scoped to this LOB (for the mini-block)

{{ex_facts_json}}
```
