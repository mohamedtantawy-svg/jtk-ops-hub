import { SLA_MINS, DEFAULT_SOURCE_URLS } from '../data/constants';
import { elapsedBizMinutes } from './bizTime';

// Re-export the visibility helper from members.js for backward compat
export { getVisibleEmailsForAccess as getVisibleEmails } from '../data/members';

export const getUrl=(t,sourceUrls)=>{if(t.externalUrl)return t.externalUrl;const u=sourceUrls||DEFAULT_SOURCE_URLS;return({zendesk:`${u.zendesk||DEFAULT_SOURCE_URLS.zendesk}/agent/tickets/${encodeURIComponent(t.id.replace('ZD-',''))}`,jira:`${u.jira||DEFAULT_SOURCE_URLS.jira}/browse/${t.id}`,gmail:`${u.gmail||DEFAULT_SOURCE_URLS.gmail}/mail/u/0/#inbox`,slack:`${u.slack||DEFAULT_SOURCE_URLS.slack}/hr-ops`,calendar:`${u.calendar||DEFAULT_SOURCE_URLS.calendar}/`,looker:`${u.looker||DEFAULT_SOURCE_URLS.looker}/dashboards`,workbench:`${u.workbench||DEFAULT_SOURCE_URLS.workbench}/tasks/${encodeURIComponent(t.id.replace('WB-',''))}`})[t.source]||'';};
export const rel=(m)=>{ if(m<=0)return'just now'; if(m<60)return`${m}m`; const h=Math.floor(m/60),r=m%60; return r?`${h}h ${r}m`:`${h}h`; };
export const ageClass=(m,s)=>{ if(s==='resolved'||s==='waiting')return''; if(m>=120)return'age-urgent'; if(m>=60)return'age-hot'; if(m>=30)return'age-warn'; return''; };
export const ageDot=(m,s)=>{ if(s==='resolved'||s==='waiting'||m<30)return null; if(m>=120)return'#d42d35'; if(m>=60)return'#ed5e2a'; return'#ed8d00'; };

// Resolve the start timestamp the SLA clock ticks from, per ticket source.
//   • Zendesk → last requester reply (`lastCustomerResponseAt`); falls back
//     to `updatedAt` then `createdAt` so the function never returns null
//     for a ticket the upstream gave us.
//   • Jira    → last update (`updatedAt`); same fallback chain.
function _slaAnchorMs(task) {
  const candidates = task?.source === 'jira'
    ? [task?.updatedAt, task?.lastCustomerResponseAt, task?.createdAt]
    : [task?.lastCustomerResponseAt, task?.updatedAt, task?.createdAt];
  for (const ts of candidates) {
    if (!ts) continue;
    const ms = typeof ts === 'number' ? ts : new Date(ts).getTime();
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return null;
}

export const slaInfo=(task,customThresholds)=>{
  if(!task||task.status==='resolved'||task.status==='waiting')return null;
  // SLA uses task-type-specific thresholds from SLA_MINS (or custom overrides).
  // Per-task `slaMinsOverride` wins over everything — e.g. Jira tickets are
  // pinned at 48h from the latest update regardless of the type detected
  // from the summary.
  // Elapsed time is measured in BUSINESS DAYS (Sat/Sun excluded) so a ticket
  // landing Friday 4 pm doesn't accumulate weekend hours against its SLA.
  // We prefer recomputing from the raw anchor timestamp when present so the
  // clock stays fresh between syncs; fall back to the normalized
  // `minutesSinceLastResponse` only if no timestamp survived.
  const anchorMs = _slaAnchorMs(task);
  const elapsed = anchorMs != null
    ? elapsedBizMinutes(anchorMs, Date.now())
    : (task.minutesSinceLastResponse != null ? task.minutesSinceLastResponse : task.minutesAgo);
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
