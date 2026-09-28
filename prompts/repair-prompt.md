# Repair prompt

Used by the "Repair Invalid Output" HTTP Request node, triggered only when
the "Validate Phase Output" Code node (see workflow) finds a schema
violation — e.g. a link not present in the source input, a non-numeric field
typed as string, a missing required section. This is a single targeted
retry, not a full re-run of the phase, per the plan's cost-control principle.

Template variables:
- `{{original_prompt}}` — the exact prompt text sent in the failed call
- `{{invalid_output}}` — the model's invalid JSON response
- `{{validation_errors}}` — array of specific error strings from the
  validator, e.g. `["stories[2].link 'https://example.com/foo' not found in input link set", "trend_direction value 'Bullish' not in allowed enum"]`

---

```
Your previous response failed schema validation. Fix ONLY the specific
issues listed below and return the corrected JSON. Do not otherwise change
the content, do not add new stories or facts, and do not apologise or
explain — return ONLY the corrected JSON object/array.

## Validation errors to fix

{{validation_errors}}

## Your previous (invalid) response

{{invalid_output}}

## Original instructions (for reference — the schema and rules still apply)

{{original_prompt}}
```

If the same call fails validation twice (i.e. this repair also fails), the
workflow drops that phase's output for the affected section, logs it to
`run_costs` with a note, and the newsletter ships with that section marked
"data unavailable this week" rather than blocking the whole edition — see
the "Handle Repair Failure" branch in the workflow.
