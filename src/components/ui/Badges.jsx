import { memo } from 'react';
import { TOOLS, FUNCTIONS } from '../../data/constants';

const badgeBase={borderRadius:'var(--radius-pill, 20px)',padding:'3px 10px',fontSize:'var(--font-xs, 11px)',fontWeight:600,display:'inline-flex',alignItems:'center',gap:4,whiteSpace:'nowrap'};

export const ToolBadge=memo(({source})=>{ const t=TOOLS[source]; if(!t)return null; return <span style={{...badgeBase,borderRadius:'var(--radius-sm, 4px)',background:t.bg,color:t.color}}><i className={t.icon} style={{fontSize:10}}></i>{t.label}</span>; });
export const FnBadge=memo(({type})=>{ const f=FUNCTIONS[type]; if(!f)return null; return <span style={{...badgeBase,background:f.bg,color:f.color}}>{f.label}</span>; });

const STATUS_STYLES = {
  new:         { background: 'var(--purple-light, #f5f0ff)', color: 'var(--purple, #7c3aed)' },
  in_progress: { background: 'var(--blue-light, #eff6ff)',   color: 'var(--blue, #1d4ed8)' },
  waiting:     { background: 'var(--surface-3, #f5f3f0)',    color: 'var(--text-secondary, #6b6560)' },
  escalated:   { background: '#fef2f2',                      color: '#d42d35' },
  resolved:    { background: 'var(--green-light, #f0fdf4)',  color: 'var(--green, #15803d)' },
  open:        { background: 'var(--purple-light, #f5f0ff)', color: 'var(--purple, #7c3aed)' },
};

const STATUS_LABELS = {
  new: 'New',
  in_progress: 'In Progress',
  waiting: 'Pause',
  escalated: 'Escalated',
  resolved: 'Resolved',
  open: 'Open',
};

const STATUS_TOOLTIPS={
  new:'Zendesk: Open | Jira: To Do | Workbench: New',
  in_progress:'Zendesk: On-Hold | Jira: In Progress | Workbench: Active',
  waiting:'Zendesk: Pending (pauses SLA) | Jira: Blocked | Workbench: Paused',
  escalated:'Task has been escalated to a manager',
  resolved:'Zendesk: Solved | Jira: Done | Workbench: Completed',
};

export const StatusBadge=memo(({status})=>{
  const s=STATUS_STYLES[status];
  if(!s)return null;
  return <span title={STATUS_TOOLTIPS[status]||''} style={{...badgeBase,...s}}>{STATUS_LABELS[status]||status}</span>;
});

// Format `rem` (minutes) for the SLA pill. Caps long durations at days /
// weeks / months / years so a 2-year-old ticket doesn't render as
// "-14868h 22m" — past a few days the exact-hour count stops conveying
// useful information and just clutters the row.
const fmtRemain=(rem)=>{
  if(!Number.isFinite(rem) || rem<=0) return null;
  if (rem < 60) return `${rem}m`;
  if (rem < 24 * 60) {
    const h=Math.floor(rem/60), m=rem%60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const days = Math.floor(rem / (24 * 60));
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return '1y+';
};

export const SlaBadge=memo(({sla,status})=>{
  if(status==='waiting'){
    return <span style={{...badgeBase,background:'#f5f3f0',color:'#9b928a',border:'1px solid #e8e4df'}} title="SLA paused while snoozed"><i className="bi-pause-circle" style={{fontSize:9,marginRight:2}}></i>Paused</span>;
  }
  if(sla){
    if(sla.breach){
      const overdue=sla.remain?fmtRemain(Math.abs(sla.remain)):null;
      return <span style={{...badgeBase,background:'var(--red-light, #fef2f2)',color:'var(--red, #b91c1c)',border:'1px solid var(--red-mid, #fee2e2)'}} title={overdue?`Breached ${overdue} ago`:'SLA Breached'}>{overdue?`-${overdue}`:'BREACH'}</span>;
    }
    const timeLeft=sla.remain?fmtRemain(sla.remain):null;
    if(sla.ok){
      return <span style={{...badgeBase,background:'var(--surface-3, #f5f3f0)',color:'var(--text-secondary, #6b6560)',border:'1px solid var(--border, #e8e4df)'}} title={timeLeft?`${timeLeft} remaining`:'On track'}>{timeLeft||'OK'}</span>;
    }
    // At Risk
    return <span style={{...badgeBase,background:'var(--orange-light, #fffbeb)',color:'var(--orange, #b45309)',border:'1px solid var(--orange-mid, #fef3c7)'}} title={`${timeLeft} remaining — at risk`}>{timeLeft||sla.short}</span>;
  }
  if(status==='resolved'){
    return <span style={{...badgeBase,color:'var(--text-muted, #9b928a)',fontSize:'var(--font-xs, 11px)'}}>--</span>;
  }
  return <span style={{...badgeBase,background:'var(--surface-3, #f5f3f0)',color:'var(--text-secondary, #6b6560)',border:'1px solid var(--border, #e8e4df)'}}>OK</span>;
});
