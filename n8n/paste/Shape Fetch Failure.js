// Node: "Shape Fetch Failure" (Code, Run Once for All Items)
// Input: the error output (index 1) of any fetch node — RSS Fetch, Reddit
//        Fetch, Customer Google News, Competitor Google News, AI Research
//        Fetch, or PR Newswire Fetch. n8n fans in each connected source as a
//        separate execution of this node, so every run's items come from
//        exactly one branch.
// Output: one row per failure in the canonical shape 'Record Fetch
//         Failures' (Supabase -> source_fetch_failures) expects.
//
// Every Load* node now emits {source_key, source_type, source_name, url}
// ahead of its fetch node (see load-rss-sources.js etc.), so continueOnFail's
// input-passthrough behavior means the failing item already carries all four
// — this just whitelists them plus the error n8n attaches, rather than
// autoMapInputData sending whatever branch-specific extra fields (aliases,
// query, cap, window_days, role...) happen to be on that item straight at a
// fixed-column table, which errors on the first field that is not a column.

function errorMessage(e) {
  if (!e) return 'unknown error';
  if (typeof e === 'string') return e;
  return e.message || e.description || JSON.stringify(e).slice(0, 500);
}

return $input.all().map((item) => ({
  json: {
    source_key: item.json.source_key || '',
    source_type: item.json.source_type || '',
    source_name: item.json.source_name || item.json.name || '',
    url: item.json.url || '',
    error: errorMessage(item.json.error)
  }
}));
