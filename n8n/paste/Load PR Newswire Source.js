// Node: "Load PR Newswire Source" (Code, Run Once for All Items)
// Output: exactly one item -> "PR Newswire Fetch" HTTP node
//
// PR Newswire has no per-item registry (it is one fixed feed, filtered
// against the customer roster downstream in match-pr-newswire-to-customers.js)
// but every other branch now emits {source_key, source_type, source_name,
// url} ahead of its fetch node. This node exists so PR Newswire follows the
// identical shape instead of being the one branch with a URL hand-coded
// straight into the HTTP node's parameters and no identity for the shared
// 'Shape Fetch Failure' node to key off.

return [
  {
    json: {
      source_key: 'pr:newswire',
      source_type: 'pr_newswire',
      source_name: 'PR Newswire',
      url: 'https://www.prnewswire.com/rss/news-releases-list.rss'
    }
  }
];
