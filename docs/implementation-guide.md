# Implementation guide — setting up Backbase Insights v3 in n8n

Follow these steps in order. Steps 1–5 are one-time setup. Step 6 is your
first test run. Step 7 adds the human-approval gate (done manually — see
why below). Step 8 is going live.

## 1. Prerequisites — accounts and access

- An n8n instance (self-hosted or n8n Cloud) with the **RSS Feed Read** and
  **Supabase** community/built-in nodes available.
- A **Supabase** project (reuse the one from the v2 workflow if you still
  have it — its existing tables are untouched by this rebuild).
- An **Anthropic API key** (console.anthropic.com) with billing enabled.
- **No Reddit API app needed.** v2 used the native Reddit node with an OAuth
  app. Reddit closed self-service app creation in November 2025 (new apps
  now need manual pre-approval), so this rebuild collects Reddit via the
  public per-subreddit RSS feed instead (`reddit.com/r/{name}/new/.rss`) —
  same `RSS Feed Read` node type as every other source, no app, no OAuth. If
  you happen to have a Reddit app from before Nov 2025 and would rather use
  the real API (higher rate limits, structured JSON), that's a fine swap —
  just re-add the native Reddit node and an OAuth2 credential for it.
- A **Browserless.io** account — **new** API key. The v2 workflow had a
  Browserless token hardcoded in plain text inside the workflow JSON, which
  is now public in your git history. Rotate/regenerate it in the Browserless
  dashboard before doing anything else, and never let a token sit in a node
  URL again — this rebuild moves it into an n8n credential (steps below).
- An email-sending credential (SMTP, or whatever the n8n Email node in your
  instance is configured against).
- A Google Drive OAuth credential, if you want the Drive archive step.

## 2. Run the Supabase schema

Open the Supabase SQL editor for your project and run
[`sql/schema.sql`](../sql/schema.sql). This adds tables alongside your
existing v2 tables (`failed_rss`, `retrieved_industry_articles`,
`failed_subreddit_retrievals`, `customer_rss_updates`, `newsletter_html`,
`merged_raw_content`) — nothing from v2 is dropped or altered:

- `seen_articles`, `run_costs`, `edition_metadata` — v3's dedup ledger,
  cost log, and per-edition metadata.
- `source_fetch_failures` — v4: one row per fetch error, from every branch
  (not just RSS/Reddit), written by `Record Fetch Failures`.
- `source_health` — v4 shape change: keyed by a generic `source_key`
  (was `source_name`, rss/reddit only) so every branch's sources get a
  rolling health record, not just two of them. Updated atomically by the
  `record_source_fetch(p_source_key, p_source_type, p_url, p_status)` and
  bulk `record_source_fetches(p_events)` Postgres functions this file also
  defines — only three consecutive `'error'` statuses quarantine a source;
  `'empty'`/`'filtered_empty'` (fetch worked, just quiet) do not.
- `ingest_scans` — v4: one row per run (scan-only, dry-run, or full),
  written by `Record Ingest Scan Row` -> `Record Ingest Scan` regardless of
  whether that run's pre-LLM coverage gate passed. This is the queryable
  history behind "did last night's cron actually cover its sources" — see
  [`docs/handoff.md`](handoff.md) "Scan-only mode and the coverage gate."

If you already ran an earlier version of this schema, `source_health`'s
primary key changed shape (`source_name` -> `source_key`) — drop and
recreate that one table rather than trying to migrate it in place; nothing
downstream depends on its old rows surviving.

## 3. Import the workflow

1. In n8n: **Workflows → Add workflow → Import from File** (or paste the
   JSON via **Import from URL/Clipboard** if you're on n8n Cloud).
2. Select [`n8n/backbase-insights-workflow.json`](../n8n/backbase-insights-workflow.json).
3. It imports as **"Backbase Insights 3.0"**, inactive. Leave it inactive
   until step 6 passes.

You'll immediately see red "credential missing" warnings on several nodes —
that's expected; step 4 fixes them.

## 4. Create and attach credentials

Create these credentials once (**Credentials → Add credential**), then
attach each to every node that needs it (n8n will list which nodes use a
given credential type when you open it).

| Credential name (suggested) | Type | Value | Used by |
|---|---|---|---|
| `Anthropic API Key` | HTTP Header Auth | Header name `x-api-key`, value = your Anthropic key | Triage Batch (Claude), Extract Facts (Claude), Synthesise Section (Claude), Repair Call (Claude), Synthesise Executive Brief (Claude) |
| `Browserless API` | HTTP Header Auth | Header name `Authorization`, value `Bearer <your new Browserless token>` | Generate PDF |

No Reddit credential is needed — `Reddit RSS Read` is a plain `RSS Feed Read`
node pointed at Reddit's public `.rss` endpoints, same as `RSS Read`.

### The Supabase credential — one credential, used two different ways

Create **one native Supabase credential** (**Credentials → Add credential →
search "Supabase"**), then fill in:
- **Host** — your Supabase Project URL (Project Settings → API, or
  Integrations → Data API on newer projects; looks like
  `https://xxxxx.supabase.co`, no `/rest/v1` suffix)
- **Service Role Secret** — Project Settings → API → API Keys → Reveal next
  to `service_role` (or the newer `sb_secret_...` secret key, if your
  project has migrated to Supabase's new key format)

Attach it two ways across the workflow:

1. **Directly**, on every `n8n-nodes-base.supabase` node (Record RSS
   Failures, Record Reddit Failures, Record Structured Content, Record Full
   HTML, Record Edition Metadata) — pick it from that node's normal
   **Credential to connect with** dropdown.
2. **Via Predefined Credential Type**, on the raw HTTP Request node that
   talks to Supabase's REST API directly — `Mark Seen`. (v3 also had a
   `Dedup Lookup` node here; v4 folds it into `Mark Seen`.) Open it, set
   **Authentication → Predefined Credential
   Type → Supabase API**, then pick the same credential. Don't use
   *Generic Credential Type → HTTP Header Auth* with just an `apikey`
   header here — Supabase's gateway (Kong) requires **both** an `apikey`
   header and an `Authorization: Bearer <key>` header, and a generic
   Header Auth credential can only inject one of them. That mismatch
   produces a `401 "No API key found in request"` even though a key was
   clearly sent. The Predefined Credential Type route sends both
   automatically and needs no manual header setup or extra env var for the
   key.

Finally, attach your **Email** and **Google Drive** credentials to the
`Send email` and `Upload file` nodes, and edit `Send email`'s `fromEmail` /
`toEmail` fields — they're placeholders right now.

## 5. Set the `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables

The Mark Seen node references `$env.SUPABASE_URL` (e.g.
`https://xxxx.supabase.co`) and `$env.SUPABASE_SERVICE_ROLE_KEY` (the same
key as the `Supabase Service Role` credential — see step 4's note on why
both an `apikey` credential header and a literal `Authorization` header are
needed).

- **Self-hosted n8n**: set both `SUPABASE_URL=https://xxxx.supabase.co` and
  `SUPABASE_SERVICE_ROLE_KEY=<your service_role key>` in the environment
  n8n runs under, then restart n8n. Confirm your instance doesn't have
  `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` set, which would block expressions
  from reading `$env` — if it does, replace the `$env.SUPABASE_URL` /
  `$env.SUPABASE_SERVICE_ROLE_KEY` expressions with the literal values
  instead.
- **n8n Cloud**: add both under **Settings → Variables** instead, same names.

## 6. First test run — dry run

Do **not** trigger the Monday 6 AM schedule yet. Instead:

1. Open the workflow, click on the **Manual Dry Run Trigger** node, and hit
   **Test workflow**.
2. Watch it execute. A few things worth checking on this first run:
   - **Load RSS Sources → RSS Read**: expect a handful of red X's — that's
     the point of the [Sprint 1 source audit](../data/rss-sources.json); any
     source still marked `needs_verification` may fail. Failures route to
     `Record RSS Failures` and don't block the run.
   - **Mark Seen → Filter New Only**: on a truly first run, `seen_articles`
     is empty, so everything should pass through as "new."
   - **Budget Gate → If Mode Is Full Or Triage-Only**: check the `mode`
     field on the Budget Gate node's output. If it says `keyword_only`
     unexpectedly, your cost-estimate constants in `Initialize Run` may need
     tuning — see the note in that node about updating the per-token price
     placeholders to match the Claude model you actually configured.
   - **Generate HTML**: open this node's output and confirm `html` looks
     right before it reaches Supabase/PDF/email.
3. Because this was the Manual Dry Run Trigger, `dry_run` is `true`, so the
   workflow stops after **Dry Run Stop** — no PDF, no email, no Drive
   upload. Your Supabase `newsletter_html` table will have the HTML for
   review.
4. Pull the HTML from Supabase (or add a temporary "download" step) and open
   it in a browser to sanity-check the layout and links before you spend
   money on repeated real runs.
5. Re-run the dry run as many times as you need while you fix source and
   prompt issues — each dry run still calls the Anthropic API (it only skips
   send/PDF/Drive), so watch your Anthropic usage dashboard, not just this
   workflow, while iterating.

## 7. Add the human-approval gate (manual step — do this in the n8n UI)

This is deliberately **not** part of the imported JSON. The two node types
it needs — **Wait** (webhook resume mode) and **Telegram** (inline keyboard)
— have parameter schemas that vary meaningfully between n8n versions, so
hand-authoring them into a static JSON file risked shipping something that
fails to import cleanly. Adding them live, where n8n's node UI validates
your inputs as you go, is the safer path. Ten-minute add:

1. **Create a Telegram bot** (if you don't have one): message
   [@BotFather](https://t.me/BotFather) on Telegram, `/newbot`, grab the
   token. Message your new bot once so it has a chat with you, then call
   `https://api.telegram.org/bot<token>/getUpdates` in a browser to read
   back your `chat.id`.
2. In n8n, add a **Telegram API** credential with that bot token.
3. In the workflow canvas, disconnect **Convert HTML to JSON for PDF** from
   **Generate PDF**'s upstream connection — actually, simplest: insert the
   new nodes **between** `Generate PDF` and `Send email`/`Upload file`.
4. Add a **Wait** node (name it "Wait For Approval"). Set **Resume**:
   `Webhook`. n8n will show you a **Resume URL** once the workflow is saved
   and this node is reached during an execution — copy it (or, on recent
   n8n versions, reference `{{ $execution.resumeUrl }}` directly in an
   expression upstream so you don't have to copy it by hand each run).
5. Add a **Telegram** node ("Send Approval Request") **before** the Wait
   node: resource `Message`, operation `Send Message`, chat ID = the
   `chat.id` from step 1, and a message text like:
   ```
   Backbase Insights draft ready for {{ $('Generate HTML').item.json.week_start }} to {{ $('Generate HTML').item.json.week_end }}.
   Mode: {{ $('Assemble Newsletter JSON').item.json.mode }}
   Approve: <resume URL>?action=approve
   Reject: <resume URL>?action=reject
   ```
   Use Telegram's **Inline Keyboard** option with two **URL buttons**
   (not callback buttons — URL buttons need no second trigger node) pointing
   at the resume URL with `?action=approve` / `?action=reject` appended.
6. After the Wait node, add an **IF** node checking whether the incoming
   webhook query param `action` equals `approve` (the Wait node passes
   through whatever the resume call received, so it'll be at
   `{{ $json.query.action }}` — confirm the exact path in your n8n version's
   Wait-node output before wiring the IF).
7. Wire **IF true → Send email + Upload file** (your existing nodes), **IF
   false → a small Code/Supabase node that updates `edition_metadata` for
   this `run_id` to `approval_status = 'rejected'`** and stops.
8. This requires your n8n instance to have a **public HTTPS URL** so
   Telegram's URL button (opened from your phone/browser) can reach the
   Wait node's resume webhook — the same requirement noted in the original
   project debrief. If you're still on Hetzner/Cloudflare Tunnel per that
   debrief, point the tunnel at this n8n instance; on n8n Cloud this is
   already handled for you.

## 8. Go live

1. Run **two full weeks** via the Manual Dry Run Trigger (with the approval
   gate wired but harmless, since dry runs stop before reaching it) to
   confirm sources, costs, and output quality are stable.
2. Then run it for real at least once by manually executing from **Monday 6
   AM Trigger** instead of the dry-run trigger (right-click the node → Test
   step, or temporarily change dryRun's default) and confirm the Telegram
   approval round-trip actually sends when you approve.
3. Once satisfied, toggle the workflow **Active**. The `Monday 6 AM Trigger`
   cron (`0 6 * * 1`) takes over from there.
4. Put a recurring reminder on your own calendar for the **quarterly source
   audit** — see [`docs/source-audit-guide.md`](source-audit-guide.md) for
   the full process. It is mostly automated now: `data/*.json` are the
   actual source of truth (`build-workflow.mjs`'s `@data` directive
   generates every `Load ... Sources` Code node directly from them, so
   there is no second copy to mirror edits into by hand — see
   [`docs/handoff.md`](handoff.md)), and
   `node newsletter/n8n/audit-sources.mjs` probes every registry's direct
   and fallback endpoints and reports what changed. You are checking the
   registries' own `status`/`tier` fields against that report, not
   re-deriving a workflow-side copy.
5. Between quarterly audits, `ingest_scans` and `source_health` (Supabase)
   are the week-to-week signal — a source crossing into `quarantined`
   status, or a run's `gate_passed` flipping to `false`, means something
   broke before the next scheduled audit. See `docs/handoff.md` "Scan-only
   mode and the coverage gate."

## Troubleshooting quick reference

| Symptom | Likely cause | Fix |
|---|---|---|
| Most RSS nodes fail | Feed URL genuinely dead or blocked by user-agent filtering | Check `Record RSS Failures` in Supabase; remove/replace the source in `data/rss-sources.json` and the matching Code node |
| Phase 1/2/3 Code nodes return empty arrays | Claude response wasn't valid JSON (model added prose) | Open the HTTP node's raw output; if the model is chatty, add `"Return ONLY JSON, nothing else."` more forcefully, or lower `max_tokens` isn't the issue — check the model name in `jsonBody` is one you actually have access to |
| `Mark Seen` errors | `SUPABASE_URL` env var not set, or `Supabase Service Role` credential missing/wrong header name | Re-check step 5 and the credential's header name is exactly `apikey` |
| Every run reports `mode: keyword_only` | Cost-estimate constants in `Initialize Run` too conservative for your actual model pricing | Adjust `main_model_input_per_m` / the `* 3` multiplier in `Budget Gate` against real spend from `run_costs` after a few weeks |
| PDF step fails | Browserless token not rotated / credential header wrong | Re-check step 4's `Browserless API` credential; confirm the header name matches what your Browserless plan expects (some plans use a `token` query param instead of a header — adjust the node accordingly) |
