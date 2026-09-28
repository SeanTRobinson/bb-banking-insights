-- Backbase Insights Newsletter — Supabase schema additions (v3)
--
-- Run this against the same Supabase project used by the v2 workflow.
-- Existing tables from v2 are kept as-is and are NOT redefined here:
--   failed_rss, retrieved_industry_articles, failed_subreddit_retrievals,
--   customer_rss_updates, newsletter_html, merged_raw_content
--
-- New tables below close the gaps identified in the revitalization plan:
-- URL-based dedup, budget/cost logging, and per-edition metadata for
-- week-over-week comparison.

-- 1. Canonical URL dedup ledger.
-- Every article/post that clears Phase 0 normalization gets an entry here
-- BEFORE it enters the LLM pipeline, so a re-run (or next week's syndication
-- of the same story) never gets re-processed or re-billed.
create table if not exists seen_articles (
  canonical_url text primary key,
  title_hash text not null,
  source_type text not null check (source_type in ('rss', 'reddit', 'customer_news', 'competitor', 'ai_research')),
  source_name text,
  first_seen_at timestamptz not null default now(),
  run_id uuid
);

create index if not exists seen_articles_title_hash_idx on seen_articles (title_hash);
create index if not exists seen_articles_first_seen_idx on seen_articles (first_seen_at);

-- 2. Per-run cost and budget tracking.
-- One row per LLM phase per run, so a run's total spend can be summed and
-- compared against the weekly budget envelope. Populated by the "Log Phase
-- Cost" Code+Supabase nodes after every Claude API call.
create table if not exists run_costs (
  id bigint generated always as identity primary key,
  run_id uuid not null,
  edition_date date not null,
  phase text not null check (phase in ('triage', 'extraction', 'synthesis', 'repair')),
  lob_tag text, -- e.g. 'sme_commercial' | 'wealth' | 'retail' | 'digital_assist' | 'community' | 'customer_radar' | 'competitor_intelligence' | 'ai_research_radar' | 'executive_brief'
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost_usd numeric(10, 4) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists run_costs_run_id_idx on run_costs (run_id);
create index if not exists run_costs_edition_date_idx on run_costs (edition_date);

-- 3. Per-edition metadata.
-- One row per newsletter edition, used for week-over-week delta reporting
-- and as the audit trail for what mode (full / triage_only / keyword_only)
-- each edition ran in and whether it was approved for send.
create table if not exists edition_metadata (
  id bigint generated always as identity primary key,
  run_id uuid not null unique,
  edition_date date not null,
  week_start date not null,
  week_end date not null,
  mode text not null check (mode in ('full', 'triage_only', 'keyword_only')),
  dry_run boolean not null default false,
  articles_collected integer not null default 0,
  articles_after_dedup integer not null default 0,
  articles_kept_after_triage integer not null default 0,
  total_cost_usd numeric(10, 4) not null default 0,
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected', 'auto_dry_run')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists edition_metadata_edition_date_idx on edition_metadata (edition_date);

-- 4a. Unified fetch failure log. Every fetch node's error output (RSS,
-- Reddit, Customer/Competitor Google News, AI Research, PR Newswire) now
-- converges on 'Shape Fetch Failure' -> 'Record Fetch Failures' (see
-- build-workflow.mjs's errorTo() and shape-fetch-failure.js), one table
-- instead of the v3 shape where only RSS and Reddit had a failure table at
-- all and every other branch's errors went nowhere. This is the raw event
-- log; source_health (below) is the rolled-up "is this source currently
-- quarantined" view derived from the SAME events via record_source_fetch,
-- not from this table.
create table if not exists source_fetch_failures (
  id bigint generated always as identity primary key,
  source_key text not null,
  source_type text not null,
  source_name text,
  url text,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists source_fetch_failures_source_key_idx on source_fetch_failures (source_key);
create index if not exists source_fetch_failures_created_at_idx on source_fetch_failures (created_at);

-- 4b. Source health, for the quarterly audit workflow AND every run's
-- coverage gate (see newsletter/n8n/node-code/build-coverage-report.js and
-- record-source-health-events.js).
--
-- v4 note: source_name -> source_key, and source_type is now generic
-- (every branch, not just rss/reddit) because every branch's Load* node now
-- emits a stable source_key from its registry (data/*.json) — see
-- newsletter/n8n/build-workflow.mjs's @data directive. This is a breaking
-- rename from the v3 shape (source_name primary key, rss|reddit only); if
-- this table already exists from v3, drop and recreate it rather than
-- migrating in place, since v3's rows used the old key shape and v3 is the
-- rollback artifact, not something v4 needs to preserve continuity with.
create table if not exists source_health (
  source_key text primary key,
  source_type text not null check (
    source_type in ('rss', 'reddit', 'customer', 'competitor', 'ai_research', 'pr_newswire')
  ),
  url text,
  consecutive_failures integer not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  status text not null default 'active' check (status in ('active', 'quarantined')),
  updated_at timestamptz not null default now()
);

-- Atomic per-source update: one INSERT ... ON CONFLICT statement, so
-- concurrent calls for different sources never block each other and two
-- calls for the SAME source (should not happen within a run, but a retried
-- HTTP node could produce one) still leave consecutive_failures correct
-- rather than racing a read-then-write from the caller.
--
-- Only 'error' advances consecutive_failures towards quarantine (>= 3
-- consecutive). 'empty' and 'filtered_empty' both mean the fetch itself
-- succeeded — the source answered, there was just nothing in-window, or
-- nothing survived normalization's own filters — so both reset the streak
-- and stamp last_success_at exactly like 'ok' does. A source recovers from
-- quarantine automatically the next time it answers without erroring;
-- there is no separate "unquarantine" step to remember to run.
create or replace function record_source_fetch(
  p_source_key text,
  p_source_type text,
  p_url text,
  p_status text -- 'ok' | 'empty' | 'filtered_empty' | 'error'
) returns void as $$
begin
  insert into source_health (
    source_key, source_type, url, consecutive_failures, last_success_at, last_failure_at, status, updated_at
  )
  values (
    p_source_key,
    p_source_type,
    p_url,
    case when p_status = 'error' then 1 else 0 end,
    case when p_status = 'error' then null else now() end,
    case when p_status = 'error' then now() else null end,
    'active',
    now()
  )
  on conflict (source_key) do update set
    source_type = excluded.source_type,
    url = coalesce(excluded.url, source_health.url),
    consecutive_failures = case
      when p_status = 'error' then source_health.consecutive_failures + 1
      else 0
    end,
    last_success_at = case when p_status = 'error' then source_health.last_success_at else now() end,
    last_failure_at = case when p_status = 'error' then now() else source_health.last_failure_at end,
    status = case
      when p_status = 'error' and source_health.consecutive_failures + 1 >= 3 then 'quarantined'
      else 'active'
    end,
    updated_at = now();
end;
$$ language plpgsql;

-- Bulk wrapper so 'Record Source Health' can be one HTTP call per run
-- instead of one per source (~100+ across all six branches). Each source's
-- update still goes through record_source_fetch, so it is still one atomic
-- statement per row; this just loops inside a single transaction rather
-- than making the n8n workflow do it over the network.
create or replace function record_source_fetches(p_events jsonb) returns void as $$
declare
  ev jsonb;
begin
  for ev in select * from jsonb_array_elements(p_events)
  loop
    perform record_source_fetch(
      ev->>'source_key',
      ev->>'source_type',
      ev->>'url',
      ev->>'status'
    );
  end loop;
end;
$$ language plpgsql;

-- 5. Ingest scan run report — one row per run (scan-only, dry-run, or full),
-- written by 'Record Ingest Scan Row' -> 'Record Ingest Scan' regardless of
-- whether the coverage gate passed, so "did last night's cron actually
-- cover the sources it's supposed to" is a table to query rather than a log
-- line to go find in n8n's execution history. See build-coverage-report.js
-- for exactly what populates gate_passed/reasons/warnings/metrics.
create table if not exists ingest_scans (
  id bigint generated always as identity primary key,
  run_id uuid not null unique,
  edition_date date not null,
  mode text not null check (mode in ('full', 'dry_run', 'scan_only')),
  gate_passed boolean not null,
  reasons jsonb not null default '[]',
  warnings jsonb not null default '[]',
  metrics jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists ingest_scans_edition_date_idx on ingest_scans (edition_date);
create index if not exists ingest_scans_gate_passed_idx on ingest_scans (gate_passed);
