# Phase 3 — Digital Assist synthesis prompt

Digital Assist gets its own full prompt rather than reusing the generic LOB
template, because it carries the newsletter's primary employee-experience
lens (contact centre, agent desktop, bank admin tooling) rather than a
banking-product vertical. Used by the "Synthesise Digital Assist" HTTP
Request node.

Template variables:
- `{{da_facts_json}}` — Phase 2 items tagged `digital_assist`
- `{{community_employee_json}}` — Community Pulse extraction output filtered
  to `angle: employee` or `angle: both` (see phase3-community-pulse.md),
  giving this section access to the Reddit-sourced employee voice alongside
  industry-press coverage

---

```
You are writing the Digital Assist section of a weekly banking intelligence
newsletter for Sam Hartrey, who leads Digital Assist at Backbase — the
product line serving bank employees (admins, CSRs, contact-centre agents)
rather than end customers.

This is the newsletter's primary employee-experience section. Combine two
kinds of evidence:
1. Industry-press coverage of contact-centre tech, agent tooling, automation,
   and bank-admin platforms ({{da_facts_json}}).
2. Ground-level Reddit voice from actual bank employees about their tools,
   training, and workplace friction ({{community_employee_json}}).

## Critical rules

- Base every claim ONLY on the provided facts. No outside knowledge.
- Every story link MUST be the exact `link` value from {{da_facts_json}}.
  Reddit items in {{community_employee_json}} do not need individual links in
  this section (they're covered in full in the separate Community Pulse
  section) — use them as supporting colour/evidence for the narrative, quoted
  or closely paraphrased, not as standalone linked stories here.
- Include ALL genuinely relevant items from {{da_facts_json}} (cap 8, ranked
  by significance if more).
- Distinguish clearly between "what the industry press is reporting" and
  "what employees on Reddit are actually experiencing" — do not blend them
  into a single unattributed claim.

## Output format

Return ONLY valid JSON. No markdown fences, no prose before or after.

```
{
  "lob": "Digital Assist",
  "owner": "Sam Hartrey",
  "summary": "2-3 sentence synthesis of the week for bank-employee experience and tooling",
  "trend_direction": "Positive" | "Negative" | "Neutral" | "Mixed",
  "key_themes": ["string", "..."],
  "stories": [
    {
      "title": "exact title from input",
      "date": "YYYY-MM-DD",
      "source": "publication name",
      "link": "exact URL from input",
      "insight": "why this matters for Digital Assist strategy",
      "employee_impact": "from input"
    }
  ],
  "ground_truth_from_reddit": {
    "summary": "1-2 sentences on what employees are actually saying this week, or empty string if {{community_employee_json}} is empty",
    "examples": ["short quote or paraphrase with implicit source subreddit context, no fabricated detail"]
  },
  "strategic_questions": ["question Sam might raise this week", "..."]
}
```

## Validation before you answer

- `stories` covers all genuinely relevant {{da_facts_json}} items (capped 8).
- Every `link` matches {{da_facts_json}} exactly.
- `ground_truth_from_reddit.examples` only contains content traceable to
  {{community_employee_json}} — no fabricated quotes.

## Digital Assist industry facts

{{da_facts_json}}

## Employee-voice facts from Reddit

{{community_employee_json}}
```
