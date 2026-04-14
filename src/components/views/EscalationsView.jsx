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

// ── Format escalatedAt timestamp ─────────────────────────────────────────────
function formatEscalatedAt(timeStr) {
  if (!timeStr) return '';
  // If it looks like HH:MM, prefix with "Today,"
  if (/^\d{1,2}:\d{2}$/.test(timeStr)) return `Today, ${timeStr}`;
  return timeStr;
}

// ── Status Dot ───────────────────────────────────────────────────────────────
function StatusDot({ status, isActionRequired }) {
  const color = isActionRequired ? '#d42d35' : status === 'pending' ? '#ed8d00' : '#29811e';
  return (
    <span style={{
      width:8, height:8, borderRadius:'50%', background:color, display:'inline-block', flexShrink:0,
    }}/>
  );
}

// ── Main View ─────────────────────────────────────────────────────────────────
const EscalationsView = ({ escalations, setEscalations, currentUser, onNewEscalation }) => {
  const [statusFilter, setStatusFilter]   = useState('all');
  const [sourceFilter, setSourceFilter]   = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [replyOpen, setReplyOpen]         = useState(null);
  const [replyText, setReplyText]         = useState({});
  const [hoveredRow, setHoveredRow]       = useState(null);
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
    const ma = parseTimeToMins(a.escalatedAt) ?? 0;
    const mb = parseTimeToMins(b.escalatedAt) ?? 0;
    return mb - ma;
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

  const myPendingIds = new Set(myPending.map(e => e.id));

  const thStyle = {
    padding:'10px 16px', fontSize:13, fontWeight:500, color:'#9e9e9e',
    textTransform:'none', letterSpacing:'normal', textAlign:'left',
    whiteSpace:'nowrap', userSelect:'none',
  };

  // Chip style helper for filter pills
  const chipStyle = (active, activeColor = '#1b1b1b', activeBg = '#1b1b1b', activeText = 'white') => ({
    padding:'5px 12px', borderRadius:128, fontSize:12, fontWeight: active ? 700 : 500,
    border:`1px solid ${active ? activeColor : '#e8e8e8'}`,
    background: active ? activeBg : 'white',
    color: active ? activeText : '#616161', cursor:'pointer',
    display:'inline-flex', alignItems:'center', gap:5, transition:'all .15s',
  });

  // Render a single escalation row
  const renderRow = (esc, isActionRequired) => {
    const source = esc.escalationSource ?? (esc.task ? 'ticket' : 'manual');
    const severity = esc.severity || 'medium';
    const pendingMins = parseTimeToMins(esc.escalatedAt);
    const pendingLabel = formatPendingTime(pendingMins);
    const pColor = pendingColor(pendingMins);
    const slaMins = severity === 'critical' ? 60 : severity === 'high' ? 90 : 120;
    const slaRemaining = pendingMins !== null ? slaMins - pendingMins : null;
    const isOpen = replyOpen === esc.id;
    const isHovered = hoveredRow === esc.id;
    const isResolved = esc.status === 'resolved';

    const borderLeft = isActionRequired ? '4px solid #d42d35' : esc.status === 'pending' ? '4px solid #ed8d00' : '4px solid #e8e8e8';
    const rowBg = isActionRequired ? '#FFFBFB' : isHovered ? '#f9f8f6' : 'white';

    return (
      <tbody key={esc.id}>
        <tr
          onMouseEnter={() => setHoveredRow(esc.id)}
          onMouseLeave={() => setHoveredRow(null)}
          style={{
            borderBottom: isOpen ? 'none' : '1px solid #f2f2f2',
            background: rowBg,
            opacity: isResolved ? 0.65 : 1,
            transition:'background 0.1s',
          }}
        >
          {/* Status */}
          <td style={{ padding:'12px 16px', borderLeft, width:40 }}>
            <StatusDot status={esc.status} isActionRequired={isActionRequired} />
          </td>

          {/* Subject */}
          <td style={{ padding:'12px 16px' }}>
            <div style={{ fontWeight:600, fontSize:13, color:'#1b1b1b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:280 }}>
              {esc.subject || esc.task?.subject || '(no subject)'}
            </div>
            {esc.reason && (
              <div style={{ fontSize:11, color:'#9e9e9e', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:280 }}>
                {esc.reason}
              </div>
            )}
          </td>

          {/* Source */}
          <td style={{ padding:'12px 16px' }}>
            <SourceBadge source={source} />
          </td>

          {/* Severity */}
          <td style={{ padding:'12px 16px' }}>
            <SeverityBadge severity={severity} />
          </td>

          {/* From */}
          <td style={{ padding:'12px 16px' }}>
            <span style={{ fontSize:12, color:'#616161', fontWeight:500 }}>{esc.escalatedBy}</span>
          </td>

          {/* Manager */}
          <td style={{ padding:'12px 16px' }}>
            <span style={{ fontSize:12, color:'#1b1b1b', fontWeight:600 }}>{esc.managerName}</span>
          </td>

          {/* Time */}
          <td style={{ padding:'12px 16px' }}>
            <span style={{ fontSize:12, color:'#616161' }}>{formatEscalatedAt(esc.escalatedAt)}</span>
          </td>

          {/* SLA */}
          <td style={{ padding:'12px 16px' }}>
            {esc.status === 'pending' && pendingLabel ? (
              <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                <span style={{ fontSize:11, fontWeight:600, color:pColor }}>
                  {pendingLabel}
                </span>
                {slaRemaining !== null && (
                  <span style={{
                    fontSize:10, fontWeight:600,
                    color: slaRemaining > 0 ? '#1f74b3' : '#d42d35',
                  }}>
                    {slaRemaining > 0 ? `${slaRemaining}m left` : 'Overdue'}
                  </span>
                )}
              </div>
            ) : isResolved && esc.resolvedBy ? (
              <span style={{ fontSize:11, color:'#29811e', fontWeight:600 }}>Resolved</span>
            ) : (
              <span style={{ fontSize:11, color:'#9e9e9e' }}>--</span>
            )}
          </td>

          {/* Actions */}
          <td style={{ padding:'12px 16px', textAlign:'right' }}>
            {esc.status === 'pending' && (isHovered || isOpen) && (
              <div style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
                {(isMgr || perms?.canDo('can_respond_escalation')) && (
                  <button onClick={() => setReplyOpen(isOpen ? null : esc.id)} style={{
                    padding:'5px 12px', borderRadius:128,
                    background: isOpen ? '#e8f0fe' : 'white', color:'#1f74b3',
                    border:`1px solid ${isOpen ? '#1f74b3' : '#e8e8e8'}`,
                    fontSize:11, cursor:'pointer', fontWeight:600, whiteSpace:'nowrap',
                  }}>
                    <i className="bi-reply" style={{ marginRight:4 }}/>Respond
                  </button>
                )}
                {perms?.canDo('can_respond_escalation') !== false && (
                  <button onClick={() => resolve(esc.id)} style={{
                    padding:'5px 12px', borderRadius:128, background:'#1b1b1b', color:'white',
                    border:'none', fontSize:11, cursor:'pointer', fontWeight:700, whiteSpace:'nowrap',
                  }}>
                    <i className="bi-check-circle" style={{ marginRight:4 }}/>Resolve
                  </button>
                )}
              </div>
            )}
            {esc.status === 'resolved' && (
              <span style={{ fontSize:11, color:'#9e9e9e' }}>
                {esc.resolvedBy && `by ${esc.resolvedBy}`}
              </span>
            )}
          </td>
        </tr>

        {/* Expandable reply row */}
        {isOpen && esc.status === 'pending' && (
          <tr style={{ background:'#fafaf9', borderBottom:'1px solid #f2f2f2' }}>
            <td colSpan={9} style={{ padding:'12px 16px 16px 56px' }}>
              <div style={{ fontSize:12, fontWeight:600, color:'#616161', marginBottom:6 }}>
                Response to {esc.escalatedBy}:
              </div>
              <textarea
                rows={2}
                value={replyText[esc.id] || ''}
                onChange={e => setReplyText(p => ({ ...p, [esc.id]: e.target.value }))}
                placeholder="Add a response note visible to the escalating agent..."
                style={{ width:'100%', maxWidth:600, border:'1px solid #e8e8e8', borderRadius:12, padding:'10px 14px', fontSize:13, color:'#1b1b1b', outline:'none', fontFamily:'inherit', resize:'vertical', boxSizing:'border-box' }}
                onFocus={e => { e.target.style.borderColor='#1f74b3'; e.target.style.boxShadow='0 0 0 3px rgba(31,116,179,0.1)'; }}
                onBlur={e => { e.target.style.borderColor='#e8e8e8'; e.target.style.boxShadow='none'; }}
              />
              <div style={{ display:'flex', gap:6, marginTop:8 }}>
                <button
                  disabled={!replyText[esc.id]?.trim()}
                  onClick={() => addResponse(esc.id)}
                  style={{ height:32, padding:'0 16px', borderRadius:128, border:'none', background:'#1b1b1b', color:'white', fontSize:12, fontWeight:700, cursor:replyText[esc.id]?.trim()?'pointer':'not-allowed', opacity:replyText[esc.id]?.trim()?1:0.45, display:'flex', alignItems:'center', gap:6 }}>
                  <i className="bi-send-fill" style={{ fontSize:10 }}/>Send Response
                </button>
                <button onClick={() => setReplyOpen(null)} style={{ height:32, padding:'0 12px', borderRadius:128, border:'1px solid #e8e8e8', background:'white', color:'#616161', fontSize:12, cursor:'pointer' }}>
                  Cancel
                </button>
              </div>
            </td>
          </tr>
        )}
      </tbody>
    );
  };

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

      {/* Single consolidated filter bar */}
      <div style={{ padding:'12px 24px', background:'white', borderBottom:'1px solid #e8e8e8', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', flexShrink:0 }}>
        {/* Source filters */}
        <div style={{ display:'flex', gap:4, alignItems:'center' }}>
          {[
            { id:'all', label:'All' },
            { id:'ticket', label:'Ticket',  icon:'bi-ticket-perforated', count:sourceCounts.ticket },
            { id:'slack',  label:'Slack',   icon:'bi-slack',             count:sourceCounts.slack },
            { id:'manual', label:'Manual',  icon:'bi-person-lines-fill', count:sourceCounts.manual },
          ].map(tab => {
            const active = sourceFilter === tab.id;
            return (
              <button key={tab.id} onClick={() => setSourceFilter(tab.id)} style={chipStyle(active)}>
                {tab.icon && <i className={tab.icon} style={{ fontSize:11 }}/>}
                {tab.label}
                {tab.count != null && tab.count > 0 && (
                  <span style={{ padding:'1px 6px', borderRadius:128, fontSize:10, fontWeight:700, background: active ? 'rgba(255,255,255,0.2)' : '#f2f2f2', color: active ? 'white' : '#9e9e9e' }}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Separator */}
        <div style={{ width:1, height:20, background:'#e8e8e8' }}/>

        {/* Severity filters */}
        <div style={{ display:'flex', gap:4, alignItems:'center' }}>
          {[
            { id:'all', label:'All Sev.' },
            { id:'critical', label:'Critical' },
            { id:'high', label:'High' },
            { id:'medium', label:'Medium' },
            { id:'low', label:'Low' },
          ].map(sv => {
            const active = severityFilter === sv.id;
            const count = sv.id !== 'all' ? severityCounts[sv.id] : null;
            const scfg = SEVERITY_CONFIG[sv.id];
            return (
              <button key={sv.id} onClick={() => setSeverityFilter(sv.id)} style={chipStyle(active, scfg?.color || '#1b1b1b', scfg?.bg || '#1b1b1b', scfg?.color || 'white')}>
                {sv.label}
                {count != null && count > 0 && (
                  <span style={{ padding:'1px 6px', borderRadius:128, fontSize:10, fontWeight:700, background: active ? 'rgba(0,0,0,0.08)' : '#f2f2f2', color: active ? scfg?.color : '#9e9e9e' }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Separator */}
        <div style={{ width:1, height:20, background:'#e8e8e8' }}/>

        {/* Status filters */}
        <div style={{ display:'flex', gap:4, alignItems:'center' }}>
          {['all','pending','resolved'].map(f => (
            <button key={f} onClick={() => setStatusFilter(f)} style={{
              ...chipStyle(statusFilter === f),
              textTransform:'capitalize',
            }}>{f === 'pending' ? `Pending (${pendingCount})` : f}</button>
          ))}
        </div>
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

      {/* Table */}
      <div style={{ flex:1, overflowY:'auto' }}>
        {vis.length === 0 && myPending.length === 0 ? (
          <EmptyState
            icon="bi-arrow-up-circle"
            title={statusFilter !== 'all' || sourceFilter !== 'all' || severityFilter !== 'all' ? 'No escalations matching filters' : 'No escalations'}
            subtitle={statusFilter !== 'all' || sourceFilter !== 'all' || severityFilter !== 'all' ? 'Try adjusting the filters above to see more results' : 'Use the arrow on any ticket to escalate, or create a Slack/manual escalation'}
          />
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'fixed' }}>
            <colgroup>
              <col style={{ width:40 }}/>
              <col style={{ width:'25%' }}/>
              <col style={{ width:'9%' }}/>
              <col style={{ width:'9%' }}/>
              <col style={{ width:'10%' }}/>
              <col style={{ width:'10%' }}/>
              <col style={{ width:'11%' }}/>
              <col style={{ width:'8%' }}/>
              <col style={{ width:'14%' }}/>
            </colgroup>
            <thead>
              <tr style={{ background:'#fafaf9', borderBottom:'1px solid #e8e8e8' }}>
                <th style={thStyle}></th>
                <th style={thStyle}>Subject</th>
                <th style={thStyle}>Source</th>
                <th style={thStyle}>Severity</th>
                <th style={thStyle}>From</th>
                <th style={thStyle}>Manager</th>
                <th style={thStyle}>Time</th>
                <th style={thStyle}>SLA</th>
                <th style={{ ...thStyle, textAlign:'right' }}>Actions</th>
              </tr>
            </thead>

            {/* Action required rows */}
            {isMgr && myPending.length > 0 && (
              <>
                <tbody>
                  <tr>
                    <td colSpan={9} style={{ padding:'12px 16px 6px', background:'#FFFBFB' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ width:8, height:8, borderRadius:'50%', background:'#d42d35', display:'inline-block' }}/>
                        <span style={{ fontSize:13, fontWeight:600, color:'#9e9e9e' }}>
                          Needs your attention
                        </span>
                        <span style={{ background:'var(--red-light, #fce9ea)', color:'var(--red, #d42d35)', fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:128 }}>
                          {myPending.length}
                        </span>
                      </div>
                    </td>
                  </tr>
                </tbody>
                {myPending.map(esc => renderRow(esc, true))}
              </>
            )}

            {/* All escalation rows */}
            {rest.length > 0 && (
              <>
                {isMgr && myPending.length > 0 && (
                  <tbody>
                    <tr>
                      <td colSpan={9} style={{ padding:'12px 16px 6px' }}>
                        <span style={{ fontSize:13, fontWeight:600, color:'#9e9e9e' }}>
                          All escalations
                        </span>
                      </td>
                    </tr>
                  </tbody>
                )}
                {rest.map(esc => renderRow(esc, false))}
              </>
            )}
          </table>
        )}
      </div>
    </div>
  );
};

export default EscalationsView;
