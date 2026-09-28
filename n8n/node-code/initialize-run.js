// Node: "Initialize Run" (Code, Run Once for All Items)
// Input:  scheduled or manual dry-run trigger, via a Set node that stamps
//         dryRun before this node runs
// Output: one run-context item, read everywhere downstream via
//         $('Initialize Run').first().json
//
// Two trigger paths:
//   Monday 6 AM Trigger      -> Set dryRun false
//   Manual Dry Run Trigger   -> Set dryRun true
const dryRun = $json.dryRun === true;

const now = new Date();
const weekEnd = new Date(now);
const weekStart = new Date(now);
weekStart.setDate(weekStart.getDate() - 7);

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const run = {
  run_id: uuid(),
  dry_run: dryRun,
  week_start: weekStart.toISOString().split('T')[0],
  week_end: weekEnd.toISOString().split('T')[0],
  edition_date: weekEnd.toISOString().split('T')[0],
  budget: {
    weekly_target_usd: 4.0,
    // Rough per-1M-token pricing placeholders — update to match the model
    // you actually configure in the HTTP nodes' jsonBody "model" field.
    triage_model_input_per_m: 0.8,
    triage_model_output_per_m: 4.0,
    main_model_input_per_m: 3.0,
    main_model_output_per_m: 15.0
  }
};

return [{ json: run }];
