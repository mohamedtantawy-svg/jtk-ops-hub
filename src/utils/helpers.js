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

  // ── SLA Extension override (Phase 3 — SLA_EXTENSIONS_PLAN.md) ──────
  // An approved sla_extension takes precedence over every other SLA
  // computation below: while now < expiresAt, the pill reads green
  // "Extended" and downstream consumers (Queue pill, BriefingView
  // breach ring, Team SLA dot, Analytics KPI) all see breach=false.
  // After expiresAt passes, this short-circuit doesn't fire and the
  // row falls through to the normal math — which will almost certainly
  // produce a red "breached" pill, exactly what the spec asks for.
  if (task.slaExtension && task.slaExtension.expiresAt) {
    const expiresMs = Date.parse(task.slaExtension.expiresAt);
    if (Number.isFinite(expiresMs) && expiresMs > Date.now()) {
      const remMins = Math.max(0, Math.round((expiresMs - Date.now()) / 60000));
      const daysLeft = Math.max(1, Math.ceil(remMins / 1440));
      return {
        label: `Extended · ${daysLeft}d left`,
        short: 'EXT',
        color: '#15803d', bg: '#f0fdf4',
        breach: false, ok: true,
        remain: remMins,
        extension: true,
      };
    }
  }

  // Friendly metric name for Zendesk pills — used by both the
  // policy-cache path below and the local-fallback path. For Jira /
  // Deel sources and unstamped Zendesk rows the generic "SLA" copy
  // applies.
  const metricLabel = task.source === 'zendesk'
    ? (task.slaMetric === 'frt' ? 'first reply'
      : task.slaMetric === 'nrt' ? 'next reply'
      : null)
    : null;

  // ── Zendesk policy-cache path (2026-05-07) ──────────────────────────
  // When the queue route enriched this ticket from `zendesk_ticket_sla`
  // (background-synced from Zendesk's policy_metrics), `slaSource ===
  // 'zendesk_policy'` and we trust Zendesk's own breach_at. This bypasses
  // our local biz-day math entirely — Zendesk's policy already factors
  // business hours, paused time, on-hold time, and the specific SLA
  // policy attached to the ticket. Fixes the "-3mo / -6w" overflows we
  // were producing by applying a flat 24h default to ancient anchors on
  // tickets whose policy clock had legitimately reset via agent activity.
  //
  //   • slaMetric ('frt' | 'nrt'): clock running → use slaBreachAt
  //   • slaMetric === null:        no clock running (caught up) → OK
  if (task.source === 'zendesk' && task.slaSource === 'zendesk_policy') {
    if (task.slaMetric === null) {
      return { label: 'OK', short: 'OK', color: '#15803d', bg: '#f0fdf4', breach: false, remain: null, ok: true };
    }
    const breachMs = task.slaBreachAt ? new Date(task.slaBreachAt).getTime() : null;
    if (Number.isFinite(breachMs)) {
      const remMs = breachMs - Date.now();
      const rem = Math.round(remMs / 60000); // minutes; negative = past breach
      if (rem <= 0) {
        const breachedLabel = metricLabel ? `${metricLabel.charAt(0).toUpperCase()}${metricLabel.slice(1)} breached` : 'SLA Breached';
        return { label: breachedLabel, short: 'BREACHED', color: '#d42d35', bg: '#ffe2de', breach: true, remain: rem };
      }
      // At-risk band — Zendesk targets are typically 24h FRT / NRT but the
      // policy can vary by ticket. Use slaTargetMins (frt/nrt minutes from
      // the cache) when available; otherwise treat anything ≤ 6h remaining
      // as at-risk (a sensible default for the most common policy windows).
      const targetMins = task.slaMetric === 'frt' && Number.isFinite(task.slaFrtMinutes) && task.slaFrtMinutes > 0
        ? task.slaFrtMinutes
        : (task.slaMetric === 'nrt' && Number.isFinite(task.slaNrtMinutes) && task.slaNrtMinutes > 0
          ? task.slaNrtMinutes
          : null);
      const atRiskCutoffMins = targetMins ? Math.max(15, Math.floor(targetMins / 4)) : 6 * 60;
      if (rem <= atRiskCutoffMins) {
        const h = Math.floor(rem / 60), m = rem % 60;
        const s = h > 0 ? `${h}h${m > 0 ? ' ' + m + 'm' : ''}` : `${m}m`;
        return { label: `${s} to ${metricLabel || 'SLA'}`, short: s + ' left', color: '#ed5e2a', bg: '#fff3ee', breach: false, remain: rem };
      }
      return { label: 'OK', short: 'OK', color: '#15803d', bg: '#f0fdf4', breach: false, remain: rem, ok: true };
    }
    // slaSource was 'zendesk_policy' but breach_at missing → treat as OK
    // rather than falling through to the local "anchor + 24h" math, which
    // is exactly the false-positive breach we're trying to eliminate.
    return { label: 'OK', short: 'OK', color: '#15803d', bg: '#f0fdf4', breach: false, remain: null, ok: true };
  }

  // ── Zendesk local FRT / NRT fallback path ───────────────────────────
  // When the SLA cache hasn't seen this ticket yet (brand-new ticket,
  // cron warming up after a deploy), fall through to the existing
  // local logic that derives FRT/NRT from the metric_set sideload (PR
  // #482 / #486 / #488). slaMetric is set by the queue route from
  // metric_set — null means "first reply done AND requester hasn't
  // replied since" → OK.
  if (task.source === 'zendesk' && task.slaMetric === null
      && task.status !== 'resolved' && task.status !== 'waiting') {
    return { label: 'OK', short: 'OK', color: '#15803d', bg: '#f0fdf4', breach: false, remain: null, ok: true };
  }

  // ── Zendesk local-fallback honesty (2026-05-18) ─────────────────────
  // When slaSource === 'local_metric_set' AND slaMetric is set (FRT/NRT
  // clock supposedly running), we DON'T have Zendesk's policy truth yet.
  // The previous biz-day math below produced false-positive breach pills
  // for long-running tickets whose policy_metrics confirm "achieved" but
  // our cache hasn't seen yet — Mohamed 2026-05-18: "lots of SLA are not
  // being pulled in correctly and creating a lot of fake positives".
  //
  // Render a neutral "SLA syncing" pill instead of guessing. The
  // queue route now fires a hot-warm against the SLA cache on missed
  // IDs (zendesk-sla-sync.warmSlaCacheForTicketIds), so the pill flips
  // to authoritative policy data on the next refresh (~30 s).
  if (task.source === 'zendesk' && task.slaSource === 'local_metric_set') {
    return {
      label: 'SLA syncing',
      short: 'SYNC',
      color: '#616161',
      bg: '#f5f5f5',
      breach: false,
      remain: null,
      ok: true,
      pendingSync: true,
    };
  }

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
  if(rem<=0){
    const breachedLabel = metricLabel ? `${metricLabel.charAt(0).toUpperCase()}${metricLabel.slice(1)} breached` : 'SLA Breached';
    return{label:breachedLabel,short:'BREACHED',color:'#d42d35',bg:'#ffe2de',breach:true,remain:rem};
  }
  const pct = elapsed / lim;
  if(pct>=0.75){const h=Math.floor(rem/60),m=rem%60;const s=h>0?`${h}h${m>0?' '+m+'m':''}`:`${m}m`;return{label:`${s} to ${metricLabel || 'SLA'}`,short:s+' left',color:'#ed5e2a',bg:'#fff3ee',breach:false,remain:rem};}
  return{label:'OK',short:'OK',color:'#15803d',bg:'#f0fdf4',breach:false,remain:rem,ok:true};
};
