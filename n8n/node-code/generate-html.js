const data = $json;
const esc = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function storiesHtml(stories) {
  return (stories || []).map((story) => `
    <article style="background:#F8F9FA;padding:16px;margin-bottom:14px;border-left:4px solid #4A90A4;border-radius:4px;">
      <h3 style="margin:0 0 8px;color:#1B365D;font-size:16px;">${esc(story.title)}</h3>
      <p style="margin:0 0 8px;color:#666;font-size:13px;">${esc(story.date)} | ${esc(story.source)}</p>
      <p style="margin:0 0 8px;color:#333;font-size:14px;line-height:1.5;">${esc(story.insight)}</p>
      ${story.employee_impact ? `<p style="margin:0 0 8px;color:#555;font-size:13px;font-style:italic;"><strong>Employee perspective:</strong> ${esc(story.employee_impact)}</p>` : ''}
      ${story.link ? `<a href="${esc(story.link)}" style="color:#4A90A4;font-weight:bold;font-size:13px;">Read source &rarr;</a>` : ''}
    </article>`).join('');
}

function sectionHtml(title, section, accent = '#4A90A4') {
  if (!section || (!section.summary && !(section.stories || []).length)) return '';
  return `
  <tr><td style="padding:32px;background:#FFF;">
    <h2 style="margin:0 0 16px;color:#1B365D;font-size:22px;border-bottom:2px solid ${accent};padding-bottom:8px;">${esc(title)}</h2>
    <p style="margin:0 0 16px;color:#333;font-size:15px;line-height:1.5;">${esc(section.summary)}</p>
    ${storiesHtml(section.stories)}
    ${section.employee_experience_note ? `<aside style="background:#FFF8DC;border:1px dashed #F4A261;padding:12px;border-radius:4px;margin-top:12px;"><strong style="color:#92400E;font-size:13px;">Employee experience:</strong><p style="margin:4px 0 0;color:#333;font-size:13px;">${esc(section.employee_experience_note)}</p></aside>` : ''}
  </td></tr>`;
}

const brief = data.executive_summary || {};
const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#F8F9FA;">
<table cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:20px 0;">
<table cellpadding="0" cellspacing="0" width="640" style="max-width:640px;background:#FFF;">
  <tr><td style="background:#1B365D;padding:28px 32px;text-align:center;">
    <h1 style="margin:0;color:#FFF;font-size:26px;">Backbase Insights</h1>
    <p style="margin:8px 0 0;color:#FFF;font-size:16px;">${esc(data.week_start)} to ${esc(data.week_end)}</p>
  </td></tr>
  <tr><td style="padding:32px;background:#FFF;">
    <h2 style="margin:0 0 16px;color:#1B365D;font-size:22px;border-bottom:2px solid #4A90A4;padding-bottom:8px;">Executive Brief</h2>
    <p style="margin:0 0 16px;color:#333;font-size:15px;line-height:1.6;">${esc(brief.overview)}</p>
    <ul style="margin:0;padding-left:20px;color:#333;font-size:14px;">${(brief.key_takeaways || []).map((x) => `<li style="margin-bottom:6px;">${esc(x)}</li>`).join('')}</ul>
  </td></tr>
  ${sectionHtml('Retail', data.retail)}
  ${sectionHtml('Wealth', data.wealth)}
  ${sectionHtml('SME & Commercial', data.sme_commercial)}
  ${sectionHtml('Employee', data.employee, '#F4A261')}
  ${sectionHtml('Banking AI', data.banking_ai, '#6366F1')}
  <tr><td style="background:#1B365D;padding:24px 32px;text-align:center;">
    <p style="margin:0;color:#FFF;font-size:13px;">${data.processing_metadata.articles_collected} articles collected | ${data.processing_metadata.articles_after_dedup} after dedup</p>
    <p style="margin:8px 0 0;color:#4A90A4;font-size:12px;">Backbase Insights — run ${esc(data.run_id)}${data.dry_run ? ' (DRY RUN)' : ''}</p>
  </td></tr>
</table></td></tr></table></body></html>`;

return [{
  json: {
    ...data,
    html,
    subject: 'Backbase Insights — ' + data.week_start + ' to ' + data.week_end
  }
}];
