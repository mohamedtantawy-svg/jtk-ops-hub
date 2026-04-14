import { useState, useEffect, useRef, useContext } from 'react';
import { PermissionsContext, SettingsContext, IntegrationsContext } from '../../App';
import { MEMBERS } from '../../data/members';
import { FLAGS } from '../../data/constants';
import Avatar from '../ui/Avatar';
import EmptyState from '../ui/EmptyState';
import { ToolBadge, FnBadge } from '../ui/Badges';

const MOCK_MANAGER_RESPONSES = [
  'Reviewed and approved. Please proceed with the recommended action and keep me posted on progress.',
  "I've looked into this. Let's schedule a quick sync to align on next steps before proceeding.",
  "Good catch escalating this. I've flagged it with the regional team — guidance by EOD.",
  'Acknowledged. Looping in compliance to review the edge case. Will update once I hear back.',
  "Thanks for the context. I've reassigned priority and updated the stakeholders. Continue monitoring.",
  "Understood the urgency. I've approved the exception — go ahead and process accordingly.",
];

const SOURCE_CONFIG = {
  ticket: { label:'Ticket',  icon:'bi-ticket-perforated', color:'#1f74b3', bg:'#e8f0fe' },
  slack:  { label:'Slack',   icon:'bi-slack',             color:'#4a154b', bg:'#f3e8f5' },
  manual: { label:'Manual',  icon:'bi-person-lines-fill', color:'#ed5e2a', bg:'#fef3ee' },
};

const SEVERITY_CONFIG = {
  critical: { label:'Critical', color:'#d42d35', bg:'#ffe2de' },
  high:     { label:'High',     color:'#ed5e2a', bg:'#fef3ee' },
  medium:   { label:'Medium',   color:'#1f74b3', bg:'#e8f0fe' },
  low:      { label:'Low',      color:'#9e9e9e', bg:'#f7f5f2' },
};

// Parse HH:MM string into minutes since midnight
function parseTimeToMins(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  if (parts.length !== 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const thenMins = h * 60 + m;
  const diff = nowMins - thenMins;
  return diff >= 0 ? diff : diff + 1440; // handle midnight wrap
}

function formatPendingTime(mins) {
  if (mins === null) return null;
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function pendingColor(mins) {
  if (mins === null) return '#9e9e9e';
  if (mins < 60)  return '#29811e';
  if (mins < 120) return '#ed8d00';
  if (mins < 240) return '#ed5e2a';
  return '#d42d35';
}

// ── Source Badge ──────────────────────────────────────────────────────────────
function SourceBadge({ source }) {
  const cfg = SOURCE_CONFIG[source] ?? SOURCE_CONFIG.manual;
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:5,
      padding:'3px 10px', borderRadius:128, fontSize:11, fontWeight:600,
      background:cfg.bg, color:cfg.color,
    }}>
      <i className={cfg.icon} style={{ fontSize:11 }}/>{cfg.label}
    </span>
  );
}

// ── Severity Badge ─────────────────────────────────────────────────────────
function SeverityBadge({ severity }) {
  const cfg = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.medium;
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:4,
      padding:'3px 10px', borderRadius:128, fontSize:11, fontWeight:700,
      background:cfg.bg, color:cfg.color,
    }}>
      <i className="bi-lightning-fill" style={{ fontSize:9 }}/>{cfg.label}
    </span>
  );
}

// ── Slack Context Block ───────────────────────────────────────────────────────
function SlackContext({ esc }) {
  if (!esc.slackChannel && !esc.slackUser) return null;
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:10, flexWrap:'wrap',
      background:'#f3e8f5', border:'1px solid #e0cce8', borderRadius:10,
      padding:'8px 12px', marginBottom:10,
    }}>
      <i className="bi-slack" style={{ color:'#4a154b', fontSize:14, flexShrink:0 }}/>
      {esc.slackChannel && (
        <span style={{ fontSize:12, fontWeight:600, color:'#4a154b' }}>{esc.slackChannel}</span>
      )}
      {esc.slackUser && (
        <span style={{ fontSize:12, color:'#616161' }}>· raised by <span style={{ fontWeight:600 }}>{esc.slackUser}</span></span>
      )}
      {esc.slackMessageUrl && (
        <a href={esc.slackMessageUrl} target="_blank" rel="noreferrer"
          style={{ fontSize:12, color:'#1f74b3', display:'flex', alignItems:'center', gap:4, marginLeft:'auto' }}>
          <i className="bi-box-arrow-up-right" style={{ fontSize:11 }}/>View message
        </a>
      )}
    </div>
  );
}

// ── Escalation Chain ──────────────────────────────────────────────────────────
function EscChain({ esc }) {
  const severity = esc.severity || 'medium';
  const agent = esc.escalatedBy || 'Agent';
  const lead  = esc.managerName || 'Lead';
  const showRM = severity === 'critical';
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8, flexWrap:'wrap' }}>
      <span style={{ fontSize:11, color:'#616161', background:'#f7f5f2', padding:'2px 8px', borderRadius:6, fontWeight:500 }}>{agent}</span>
      <i className="bi-chevron-right" style={{ fontSize:9, color:'#9e9e9e' }}/>
      <span style={{ fontSize:11, color:'#1f74b3', background:'#e8f0fe', padding:'2px 8px', borderRadius:6, fontWeight:600 }}>{lead}</span>
      {showRM && <>
        <i className="bi-chevron-right" style={{ fontSize:9, color:'#9e9e9e' }}/>
        <span style={{ fontSize:11, color:'#d42d35', background:'#ffe2de', padding:'2px 8px', borderRadius:6, fontWeight:700 }}>Regional Manager</span>
      </>}
    </div>
  );
}

// ── Escalation Card ───────────────────────────────────────────────────────────
function EscCard({ esc, isActionRequired, isMgr, currentUser, onResolve, onAddResponse, replyOpen, setReplyOpen, replyText, setReplyText, settings }) {
  const perms  = useContext(PermissionsContext);
  const task   = esc.task;
  const isOpen = replyOpen === esc.id;
  const source = esc.escalationSource ?? (task ? 'ticket' : 'manual');
  const severity = esc.severity || 'medium';

  const borderAccent = isActionRequired ? '#d42d35' : esc.status === 'pending' ? '#ed8d00' : '#e8e8e8';

  // Pending time
  const pendingMins = parseTimeToMins(esc.escalatedAt);
  const pendingLabel = formatPendingTime(pendingMins);
  const pColor = pendingColor(pendingMins);
  // SLA remaining: medium = 2hr window
  const slaMins = severity === 'critical' ? 60 : severity === 'high' ? 90 : 120;
  const slaRemaining = pendingMins !== null ? slaMins - pendingMins : null;

  // Resolved cards are visually muted
  const resolvedStyle = esc.status === 'resolved'
    ? { opacity: 0.65, filter: 'grayscale(0.3)' }
    : {};

  return (
    <div style={{
      background:'white',
      border:`1px solid ${isActionRequired ? '#FECDD3' : '#e8e8e8'}`,
      borderLeft:`4px solid ${borderAccent}`,
      borderRadius:12, padding:'14px 16px', marginBottom:12,
      boxShadow:'0 1px 2px rgba(0,0,0,0.04)', transition:'box-shadow .15s',
      ...resolvedStyle,
    }}
      onMouseEnter={e => e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)'}
    >
      {/* Card row with space-between */}
      <div style={{ display:'flex', alignItems:'flex-start', gap:12, justifyContent:'space-between' }}>
        {/* Left content */}
        <div style={{ flex:1, minWidth:0 }}>

          {/* Top row — badges */}
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:8, alignItems:'center' }}>
            {isActionRequired && (
              <span style={{ background:'#FFF1F2', color:'#d42d35', fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:128, display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ width:6, height:6, borderRadius:'50%', background:'#d42d35', display:'inline-block' }}/>
                Action Required
              </span>
            )}
            {!isActionRequired && (
              <span style={{ background:esc.status==='pending'?'#fff8e6':'#fafaf9', color:esc.status==='pending'?'#ed8d00':'#616161', fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:128 }}>
                {esc.status === 'pending' ? 'Pending' : 'Resolved'}
              </span>
            )}

            {/* Severity badge */}
            <SeverityBadge severity={severity} />

            {/* Source badge — always shown */}
            <SourceBadge source={source} />

            {/* Ticket badges */}
            {task && <><ToolBadge source={task.source}/><FnBadge type={task.type}/></>}

            <span style={{ color:'#9e9e9e', fontSize:11, marginLeft:'auto' }}>{formatEscalatedAt(esc.escalatedAt)}</span>
          </div>

          {/* Escalation chain */}
          <EscChain esc={esc} />

          {/* Pending time: "Xh Ym pending" format */}
          {esc.status === 'pending' && pendingLabel && (
            <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8, flexWrap:'wrap' }}>
              <span style={{ fontSize:'var(--font-xs)', fontWeight:600, color:'var(--text-muted)', background:pColor+'15', padding:'2px 8px', borderRadius:128 }}>
                <i className="bi-clock" style={{ marginRight:4 }}/>
                {pendingLabel} pending
              </span>
              {slaRemaining !== null && (
                <span style={{ fontSize:11, fontWeight:600, color:slaRemaining>0?'#1f74b3':'#d42d35', background:slaRemaining>0?'#e8f0fe':'#ffe2de', padding:'2px 8px', borderRadius:128 }}>
                  SLA: {slaRemaining>0?`${slaRemaining}m remaining`:'Overdue'}
                </span>
              )}
            </div>
          )}

          {/* Subject */}
          <div style={{ fontWeight:700, fontSize:14, color:'#1b1b1b', marginBottom:8 }}>
            {esc.subject || task?.subject || '(no subject)'}
          </div>

          {/* Slack context block */}
          {source === 'slack' && settings?.escal_notify_slack!==false && <SlackContext esc={esc} />}

          {/* Reason */}
          <div style={{
            background: isActionRequired ? '#FFF8F8' : '#fafaf9',
            borderRadius:12, padding:'10px 12px', fontSize:13, color:'#1b1b1b',
            lineHeight:1.55, marginBottom:10,
            border:`1px solid ${isActionRequired ? '#FECDD3' : '#f2f2f2'}`,
          }}>
            <span style={{ fontWeight:600, color:'#616161' }}>Reason{settings?.escal_require_note!==false?' (required)':''}: </span>{esc.reason}
          </div>

          {/* Manager response section */}
          <div style={{ marginBottom:10 }}>
            <div style={{ display:'inline-flex', alignItems:'center', gap:6, marginBottom:6, fontSize:12, fontWeight:600 }}>
              <span style={{ width:8, height:8, borderRadius:'50%', background:esc.managerResponseStatus==='responded'?'#29811e':'#ed8d00', display:'inline-block', flexShrink:0 }}/>
              <span style={{ color:esc.managerResponseStatus==='responded'?'#29811e':'#92400E' }}>
                {esc.managerResponseStatus === 'responded' ? 'Manager Responded' : 'Pending Response'}
              </span>
            </div>
            {esc.managerResponseStatus === 'responded' && esc.managerResponse ? (
              <div style={{ background:'#f9f8f6', borderRadius:12, padding:'10px 12px', fontSize:12, color:'#1b1b1b', lineHeight:1.55, border:'1px solid #e8e8e8', display:'flex', gap:6 }}>
                <i className="bi-reply-fill" style={{ color:'#1f74b3', fontSize:12, marginTop:1, flexShrink:0 }}/>
                <div style={{ maxWidth:600, lineHeight:'var(--lh-base)' }}>
                  <div style={{ fontWeight:600, color:'#1f74b3', marginBottom:2 }}>
                    {esc.managerRespondedBy} <span style={{ fontWeight:400, color:'#616161' }}>at {esc.managerRespondedAt}</span>
                  </div>
                  <div style={{ color:'#1b1b1b' }}>{esc.managerResponse}</div>
                </div>
              </div>
            ) : esc.status === 'pending' && esc.managerResponseStatus === 'pending_response' && !isMgr ? (
              <div style={{ display:'inline-flex', alignItems:'center', gap:5, background:'#fff8e6', border:'1px solid #ffe27c', borderRadius:128, padding:'5px 12px', fontSize:12, color:'#92400E' }}>
                <span style={{ width:6, height:6, borderRadius:'50%', background:'#ed8d00', display:'inline-block', flexShrink:0 }}/>
                <span style={{ fontWeight:600 }}>Awaiting manager review</span>
                <span style={{ color:'#B45309' }}>— {esc.managerName}</span>
              </div>
            ) : null}
          </div>

          {/* Footer meta */}
          <div style={{ display:'flex', gap:14, flexWrap:'wrap', alignItems:'center' }}>
            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
              <i className="bi-person" style={{ color:'#9e9e9e', fontSize:12 }}/>
              <span style={{ fontSize:12, color:'#616161' }}>
                From <span style={{ fontWeight:600 }}>{esc.escalatedBy}</span>
              </span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
              <i className="bi-arrow-up-right" style={{ color:'#9e9e9e', fontSize:12 }}/>
              <span style={{ fontSize:12, color:'#616161' }}>
                To <span style={{ fontWeight:600, color:'#d42d35' }}>{esc.managerName}</span>
              </span>
            </div>
            {task && (
              <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ fontSize:12 }}>{FLAGS[task.country]}</span>
                <span style={{ fontSize:12, color:'#9e9e9e' }}>{task.id}</span>
              </div>
            )}
            {esc.resolvedBy && (
              <div style={{ fontSize:12, color:'#616161' }}>
                Resolved by <span style={{ fontWeight:600 }}>{esc.resolvedBy}</span> at {esc.resolvedAt}
              </div>
            )}
          </div>
        </div>

        {/* Right-side action panel */}
        {esc.status === 'pending' && (
          <div style={{ display:'flex', flexDirection:'column', gap:6, flexShrink:0, alignItems:'flex-end' }}>
            {(isMgr || perms?.canDo('can_respond_escalation')) && (
              <button onClick={() => setReplyOpen(isOpen ? null : esc.id)} style={{
                padding:'7px 14px', borderRadius:128,
                background:isOpen?'#e8f0fe':'white', color:'#1f74b3',
                border:`1px solid ${isOpen?'#1f74b3':'#e8e8e8'}`,
                fontSize:12, cursor:'pointer', fontWeight:600, whiteSpace:'nowrap',
              }}>
                <i className="bi-reply" style={{ marginRight:4 }}/>Respond
              </button>
            )}
            {perms?.canDo('can_respond_escalation')!==false&&<button onClick={() => onResolve(esc.id)} style={{
              padding:'8px 16px', borderRadius:128, background:'#1b1b1b', color:'white',
              border:'none', fontSize:12, cursor:'pointer', fontWeight:700, whiteSpace:'nowrap',
            }}>
              <i className="bi-check-circle" style={{ marginRight:4 }}/>Resolve
            </button>}
          </div>
        )}
      </div>

      {/* Reply box */}
      {isOpen && esc.status === 'pending' && (
        <div style={{ marginTop:12, borderTop:'1px solid #f2f2f2', paddingTop:12 }}>
          <div style={{ fontSize:12, fontWeight:600, color:'#616161', marginBottom:6 }}>
            Response to {esc.escalatedBy}:
          </div>
          <textarea
            rows={2}
            value={replyText[esc.id] || ''}
            onChange={e => setReplyText(p => ({ ...p, [esc.id]: e.target.value }))}
            placeholder="Add a response note visible to the escalating agent…"
            style={{ width:'100%', border:'1px solid #e8e8e8', borderRadius:12, padding:'10px 14px', fontSize:14, color:'#1b1b1b', outline:'none', fontFamily:'inherit', resize:'vertical', boxSizing:'border-box' }}
            onFocus={e => { e.target.style.borderColor='#1f74b3'; e.target.style.boxShadow='0 0 0 3px rgba(31,116,179,0.1)'; }}
            onBlur={e => { e.target.style.borderColor='#e8e8e8'; e.target.style.boxShadow='none'; }}
          />
          <div style={{ display:'flex', gap:6, marginTop:8 }}>
            <button
              disabled={!replyText[esc.id]?.trim()}
              onClick={() => onAddResponse(esc.id)}
              style={{ height:36, padding:'0 18px', borderRadius:128, border:'none', background:'#1b1b1b', color:'white', fontSize:13, fontWeight:700, cursor:replyText[esc.id]?.trim()?'pointer':'not-allowed', opacity:replyText[esc.id]?.trim()?1:0.45, display:'flex', alignItems:'center', gap:6 }}>
              <i className="bi-send-fill" style={{ fontSize:11 }}/>Send Response
            </button>
            <button onClick={() => setReplyOpen(null)} style={{ height:36, padding:'0 14px', borderRadius:128, border:'1px solid #e8e8e8', background:'white', color:'#616161', fontSize:13, cursor:'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Format escalatedAt timestamp ─────────────────────────────────────────────
function formatEscalatedAt(timeStr) {
  if (!timeStr) return '';
  // If it looks like HH:MM, prefix with "Today,"
  if (/^\d{1,2}:\d{2}$/.test(timeStr)) return `Today, ${timeStr}`;
  return timeStr;
}

// ── Main View ─────────────────────────────────────────────────────────────────
const EscalationsView = ({ escalations, setEscalations, currentUser, onNewEscalation }) => {
  const [statusFilter, setStatusFilter]   = useState('all');
  const [sourceFilter, setSourceFilter]   = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [replyOpen, setReplyOpen]         = useState(null);
  const [replyText, setReplyText]         = useState({});
  const [localToast, setLocalToast]       = useState(null);
  const localToastTimer                   = useRef(null);
  const autoRespondTimers                 = useRef({});

  const showLocalToast = (msg) => {
    if (localToastTimer.current) clearTimeout(localToastTimer.current);
    setLocalToast(msg);
    localToastTimer.current = setTimeout(() => setLocalToast(null), 3000);
  };

  const perms = useContext(PermissionsContext);
  const settings = useContext(SettingsContext);
  const { jiraData, slackData } = useContext(IntegrationsContext);
  const isAdmin = perms?.dataScope==='all_tasks';
  const isLead  = perms?.dataScope==='team_tasks';
  const isMgr   = isAdmin || isLead;

  // Auto-respond simulation
  useEffect(() => {
    escalations.forEach(esc => {
      if (esc.status === 'pending' && esc.managerResponseStatus === 'pending_response' && !autoRespondTimers.current[esc.id]) {
        autoRespondTimers.current[esc.id] = setTimeout(() => {
          const now = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
          const mock = MOCK_MANAGER_RESPONSES[Math.floor(Math.random() * MOCK_MANAGER_RESPONSES.length)];
          setEscalations(prev => prev.map(e =>
            e.id === esc.id && e.managerResponseStatus === 'pending_response'
              ? { ...e, managerResponseStatus:'responded', managerResponse:mock, managerRespondedAt:now, managerRespondedBy:e.managerName }
              : e
          ));
          delete autoRespondTimers.current[esc.id];
        }, 4000 + Math.random() * 3000);
      }
    });
    return () => { Object.values(autoRespondTimers.current).forEach(clearTimeout); };
  }, [escalations, setEscalations]);

  // Role filter
  let vis = escalations;
  if (!isAdmin) {
    vis = isLead
      ? escalations.filter(e => MEMBERS.find(m => m.id === e.task?.assigneeId)?.team === currentUser.team || e.escalatedBy === currentUser.name)
      : escalations.filter(e => e.task?.assigneeId === currentUser.id || e.escalatedBy === currentUser.name);
  }

  // Status + source + severity filters
  if (statusFilter === 'pending')  vis = vis.filter(e => e.status === 'pending');
  if (statusFilter === 'resolved') vis = vis.filter(e => e.status === 'resolved');
  if (sourceFilter !== 'all') {
    vis = vis.filter(e => (e.escalationSource ?? (e.task ? 'ticket' : 'manual')) === sourceFilter);
  }
  if (severityFilter !== 'all') {
    vis = vis.filter(e => (e.severity || 'medium') === severityFilter);
  }

  const resolve = id => {
    setEscalations(prev => prev.map(e =>
      e.id === id ? { ...e, status:'resolved', resolvedBy:currentUser.name, resolvedAt:new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) } : e
    ));
    showLocalToast('Escalation resolved successfully');
  };

  const addResponse = id => {
    const t = replyText[id];
    if (!t?.trim()) return;
    const now = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
    setEscalations(prev => prev.map(e =>
      e.id === id ? { ...e, managerNote:t.trim(), noteBy:currentUser.name, noteAt:now, managerResponseStatus:'responded', managerResponse:t.trim(), managerRespondedAt:now, managerRespondedBy:currentUser.name } : e
    ));
    setReplyOpen(null);
    setReplyText(prev => ({ ...prev, [id]:'' }));
  };

  // Sort "Action Required" by critical severity first, then oldest first
  const severityOrder = { critical:0, high:1, medium:2, low:3 };
  const myPendingRaw = isMgr ? vis.filter(e => e.status === 'pending' && e.managerId === currentUser.id) : [];
  const myPending = [...myPendingRaw].sort((a, b) => {
    const sa = severityOrder[a.severity || 'medium'] ?? 2;
    const sb = severityOrder[b.severity || 'medium'] ?? 2;
    if (sa !== sb) return sa - sb;
    // oldest first — parse escalatedAt
    const ma = parseTimeToMins(a.escalatedAt) ?? 0;
    const mb = parseTimeToMins(b.escalatedAt) ?? 0;
    return mb - ma; // more minutes ago = older
  });

  const rest = vis.filter(e => !myPending.find(p => p.id === e.id));

  const pendingCount = vis.filter(e => e.status === 'pending').length;

  // Source counts for filter badges
  const sourceCounts = {
    ticket: escalations.filter(e => (e.escalationSource ?? (e.task ? 'ticket' : 'manual')) === 'ticket').length,
    slack:  escalations.filter(e => (e.escalationSource ?? (e.task ? 'ticket' : 'manual')) === 'slack').length,
    manual: escalations.filter(e => (e.escalationSource ?? (e.task ? 'ticket' : 'manual')) === 'manual').length,
  };

  // Severity counts
  const severityCounts = {
    critical: escalations.filter(e => (e.severity||'medium') === 'critical').length,
    high:     escalations.filter(e => (e.severity||'medium') === 'high').length,
    medium:   escalations.filter(e => (e.severity||'medium') === 'medium').length,
    low:      escalations.filter(e => (e.severity||'medium') === 'low').length,
  };

  const cardProps = { isMgr, currentUser, onResolve:resolve, onAddResponse:addResponse, replyOpen, setReplyOpen, replyText, setReplyText, settings };

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {/* Header */}
      <div style={{ padding:'24px 24px 0', background:'white', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:16 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ width:40, height:40, background:'#FFF1F2', borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <i className="bi-arrow-up-circle-fill" style={{ color:'#d42d35', fontSize:20 }}/>
            </div>
            <div>
              <h1 style={{ fontSize:24, fontWeight:700, color:'#1b1b1b', margin:0 }}>Escalations</h1>
              <p style={{ fontSize:13, color:'#9e9e9e', margin:'3px 0 0' }}>
                <span style={{ fontWeight:600, color:'#1b1b1b' }}>{pendingCount}</span> pending · {isMgr ? 'manager pipeline' : 'your escalations'}
              </p>
            </div>
          </div>
          <button onClick={onNewEscalation} style={{
            display:'inline-flex', alignItems:'center', gap:6, padding:'9px 18px',
            borderRadius:128, border:'none', background:'#d42d35', color:'white',
            fontSize:14, fontWeight:600, cursor:'pointer',
          }}
            onMouseEnter={e => e.currentTarget.style.opacity='.85'}
            onMouseLeave={e => e.currentTarget.style.opacity='1'}
          >
            <i className="bi-plus-lg" style={{ fontSize:13 }}/> New Escalation
          </button>
        </div>

        {/* Source filter tabs */}
        <div style={{ display:'flex', gap:6, borderBottom:'1px solid #e8e8e8', marginBottom:0, padding:'4px 0' }}>
          {[
            { id:'all',    label:'All' },
            { id:'ticket', label:'Ticket',  icon:'bi-ticket-perforated', count:sourceCounts.ticket },
            { id:'slack',  label:'Slack',   icon:'bi-slack',             count:sourceCounts.slack },
            { id:'manual', label:'Manual',  icon:'bi-person-lines-fill', count:sourceCounts.manual },
          ].map(tab => {
            const active = sourceFilter === tab.id;
            const cfg = SOURCE_CONFIG[tab.id];
            return (
              <button key={tab.id} onClick={() => setSourceFilter(tab.id)} style={{
                padding:'8px 16px', background: active ? '#f3eff8' : 'transparent', border:'none', cursor:'pointer',
                fontSize:13, fontWeight: active ? 600 : 500,
                color: active ? '#6b3fa0' : '#616161',
                borderBottom:'none', borderRadius:8,
                display:'flex', alignItems:'center', gap:6, transition:'all .15s',
              }}>
                {tab.icon && <i className={tab.icon} style={{ fontSize:12, color: active ? cfg?.color : '#9e9e9e' }}/>}
                {tab.label}
                {tab.count != null && tab.count > 0 && (
                  <span style={{ padding:'1px 7px', borderRadius:128, fontSize:11, fontWeight:700, background: active ? '#1b1b1b' : '#f2f2f2', color: active ? 'white' : '#616161' }}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}

          {/* Status filter pushed right */}
          <div style={{ marginLeft:'auto', display:'flex', gap:6, alignItems:'center', paddingBottom:6 }}>
            {['all','pending','resolved'].map(f => (
              <button key={f} onClick={() => setStatusFilter(f)} style={{
                padding:'5px 12px', borderRadius:128, fontSize:12, fontWeight: statusFilter===f ? 700 : 500,
                border:`1px solid ${statusFilter===f ? '#1b1b1b' : '#e8e8e8'}`,
                background: statusFilter===f ? '#1b1b1b' : 'white',
                color: statusFilter===f ? 'white' : '#616161', cursor:'pointer',
                textTransform:'capitalize',
              }}>{f}</button>
            ))}
          </div>
        </div>

        {/* Severity filter row */}
        <div style={{ display:'flex', gap:6, padding:'10px 0', borderBottom:'1px solid #f2f2f2', flexWrap:'wrap', alignItems:'center' }}>
          <span style={{ fontSize:13, fontWeight:600, color:'#9e9e9e', marginRight:4 }}>Severity:</span>
          {[
            { id:'all', label:'All' },
            { id:'critical', label:'Critical' },
            { id:'high', label:'High' },
            { id:'medium', label:'Medium' },
            { id:'low', label:'Low' },
          ].map(sv => {
            const active = severityFilter === sv.id;
            const count = sv.id !== 'all' ? severityCounts[sv.id] : null;
            return (
              <button key={sv.id} onClick={() => setSeverityFilter(sv.id)} style={{
                padding:'4px 12px', borderRadius:128, fontSize:12, fontWeight: active ? 700 : 500,
                border: `1px solid ${active ? 'var(--purple)' : '#e8e8e8'}`,
                background: active ? 'var(--purple)' : 'var(--surface-3)',
                color: active ? '#fff' : 'var(--text-secondary)',
                cursor:'pointer', display:'flex', alignItems:'center', gap:5, transition:'all .15s',
              }}>
                {sv.label}
                {count != null && count > 0 && (
                  <span style={{ padding:'1px 6px', borderRadius:128, fontSize:10, fontWeight:700, background: active ? 'rgba(255,255,255,0.2)' : '#f2f2f2', color: active ? '#fff' : '#9e9e9e' }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {/* Live integration indicators */}
        {(jiraData?.isAvailable||slackData?.isAvailable)&&(
          <div style={{display:'flex',gap:8,padding:'8px 0',flexWrap:'wrap'}}>
            {slackData?.isAvailable&&slackData.escalationMessages&&(
              <span style={{fontSize:11,fontWeight:600,color:'#611f69',background:'#f3e8f9',padding:'3px 10px',borderRadius:99,display:'inline-flex',alignItems:'center',gap:5}}>
                <span style={{width:5,height:5,borderRadius:'50%',background:'#611f69',display:'inline-block'}}/>
                {slackData.escalationMessages.length} Slack escalation messages
              </span>
            )}
            {jiraData?.isAvailable&&(
              <span style={{fontSize:11,fontWeight:600,color:'#0052CC',background:'#e6efff',padding:'3px 10px',borderRadius:99,display:'inline-flex',alignItems:'center',gap:5}}>
                <span style={{width:5,height:5,borderRadius:'50%',background:'#0052CC',display:'inline-block'}}/>
                {jiraData.issues?.length||0} Jira issues linked
              </span>
            )}
          </div>
        )}
      </div>

      {/* Local success toast */}
      {localToast && (
        <div style={{
          position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)',
          background:'#1b1b1b', color:'white', borderRadius:12, padding:'10px 20px',
          fontSize:13, fontWeight:600, zIndex:900, display:'flex', alignItems:'center', gap:8,
          boxShadow:'0 4px 16px rgba(0,0,0,0.15)', pointerEvents:'none',
        }}>
          <i className="bi-check-circle-fill" style={{ color:'#29811e' }}/>
          {localToast}
        </div>
      )}

      {/* Cards */}
      <div style={{ flex:1, padding:'20px 24px', overflowY:'auto' }}>
        {/* Action required section */}
        {isMgr && myPending.length > 0 && (
          <div style={{ marginBottom:22 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
              <span style={{ width:8, height:8, borderRadius:'50%', background:'#d42d35', display:'inline-block' }}/>
              <span style={{ fontSize:13, fontWeight:600, color:'#9e9e9e', letterSpacing:'normal', textTransform:'none' }}>
                Needs your attention
              </span>
              <span style={{ background: 'var(--red-light)', color:'var(--red)', fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:128 }}>
                {myPending.length}
              </span>
            </div>
            {myPending.map(esc => <EscCard key={esc.id} esc={esc} isActionRequired={true} {...cardProps}/>)}
          </div>
        )}

        {/* Empty state */}
        {vis.length === 0 && myPending.length === 0 ? (
          <EmptyState
            icon="bi-arrow-up-circle"
            title={statusFilter !== 'all' || sourceFilter !== 'all' || severityFilter !== 'all' ? 'No escalations matching filters' : 'No escalations'}
            subtitle={statusFilter !== 'all' || sourceFilter !== 'all' || severityFilter !== 'all' ? 'Try adjusting the filters above to see more results' : 'Use → Mgr on any ticket to escalate, or create a Slack/manual escalation above'}
          />
        ) : rest.length > 0 ? (
          <div>
            {isMgr && myPending.length > 0 && (
              <div style={{ fontSize:13, fontWeight:600, color:'#9e9e9e', letterSpacing:'normal', textTransform:'none', marginBottom:10 }}>
                All escalations
              </div>
            )}
            {rest.map(esc => <EscCard key={esc.id} esc={esc} isActionRequired={false} {...cardProps}/>)}
          </div>
        ) : myPending.length === 0 ? null : null}
      </div>
    </div>
  );
};

export default EscalationsView;
