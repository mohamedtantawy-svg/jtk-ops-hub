import { SLA_MINS, DEFAULT_SOURCE_URLS } from '../data/constants';

// Re-export the visibility helper from members.js for backward compat
export { getVisibleEmailsForAccess as getVisibleEmails } from '../data/members';

export const getUrl=(t,sourceUrls)=>{if(t.externalUrl)return t.externalUrl;const u=sourceUrls||DEFAULT_SOURCE_URLS;return({zendesk:`${u.zendesk||DEFAULT_SOURCE_URLS.zendesk}/agent/tickets/${encodeURIComponent(t.id.replace('ZD-',''))}`,jira:`${u.jira||DEFAULT_SOURCE_URLS.jira}/browse/${t.id}`,gmail:`${u.gmail||DEFAULT_SOURCE_URLS.gmail}/mail/u/0/#inbox`,slack:`${u.slack||DEFAULT_SOURCE_URLS.slack}/hr-ops`,calendar:`${u.calendar||DEFAULT_SOURCE_URLS.calendar}/`,looker:`${u.looker||DEFAULT_SOURCE_URLS.looker}/dashboards`,workbench:`${u.workbench||DEFAULT_SOURCE_URLS.workbench}/tasks/${encodeURIComponent(t.id.replace('WB-',''))}`})[t.source]||'';};
export const rel=(m)=>{ if(m<=0)return'just now'; if(m<60)return`${m}m`; const h=Math.floor(m/60),r=m%60; return r?`${h}h ${r}m`:`${h}h`; };
export const ageClass=(m,s)=>{ if(s==='resolved'||s==='waiting')return''; if(m>=120)return'age-urgent'; if(m>=60)return'age-hot'; if(m>=30)return'age-warn'; return''; };
export const ageDot=(m,s)=>{ if(s==='resolved'||s==='waiting'||m<30)return null; if(m>=120)return'#d42d35'; if(m>=60)return'#ed5e2a'; return'#ed8d00'; };
export const slaInfo=(task,customThresholds)=>{
  if(task.status==='resolved'||task.status==='waiting')return null;
  // SLA uses task-type-specific thresholds from SLA_MINS (or custom overrides).
  // Per-task `slaMinsOverride` wins over everything — e.g. Jira tickets are
  // pinned at 24h from the latest update (Pilar's 2026-04-22 rule) regardless
  // of the type detected from the summary.
  const elapsed = task.minutesSinceLastResponse != null ? task.minutesSinceLastResponse : task.minutesAgo;
  const thresholds = customThresholds || SLA_MINS;
  const lim = Number.isFinite(task.slaMinsOverride) && task.slaMinsOverride > 0
    ? task.slaMinsOverride
    : (thresholds[task.type] || SLA_MINS[task.type] || 1440);
  const rem = lim - elapsed;
  if(rem<=0)return{label:'SLA Breached',short:'BREACHED',color:'#d42d35',bg:'#ffe2de',breach:true,remain:rem};
  const pct = elapsed / lim;
  if(pct>=0.75){const h=Math.floor(rem/60),m=rem%60;const s=h>0?`${h}h${m>0?' '+m+'m':''}`:`${m}m`;return{label:`${s} to SLA`,short:s+' left',color:'#ed5e2a',bg:'#fff3ee',breach:false,remain:rem};}
  return{label:'OK',short:'OK',color:'#15803d',bg:'#f0fdf4',breach:false,remain:rem,ok:true};
};
