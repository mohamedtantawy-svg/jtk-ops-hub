import { useState, useMemo, useContext } from 'react';
import { PermissionsContext } from '../../App';
import { MEMBERS } from '../../data/members';
import { OUTBOUND_TEAMS, REQUEST_STATUSES } from '../../data/requests';
import { updateRequest as apiUpdateRequest } from '../../services/requestsApi';

const priorityColors = { low:'#29811e', medium:'#1f74b3', high:'#ed5e2a', critical:'#d42d35' };
const priorityBg    = { low:'#e6f4e5', medium:'#e8f0fe', high:'#fef3ee', critical:'#fce9ea' };

const sourceIcons = {
  zendesk:'bi-headset', jira:'bi-kanban', gmail:'bi-envelope',
  workbench:'bi-tools', slack:'bi-chat-dots', looker:'bi-bar-chart-line',
};

function relTime(iso) {
  const diff = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff/60)}h ago`;
  return `${Math.floor(diff/1440)}d ago`;
}

// ── Detail Panel ─────────────────────────────────────────────────────────────
function RequestDetail({ req, onClose, onUpdateStatus, onUpdateRef, currentUser }) {
  const [editingRef, setEditingRef] = useState(false);
  const [refVal, setRefVal]         = useState(req.externalRef ?? '');
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesVal, setNotesVal]     = useState(req.notes ?? '');

  const team       = OUTBOUND_TEAMS.find(t => t.id === req.toTeam);
  const statusInfo = REQUEST_STATUSES.find(s => s.id === req.status);
  const raiser     = MEMBERS.find(m => m.id === req.raisedById);
  const initials   = raiser?.name.split(' ').map(w=>w[0]).join('').slice(0,2) ?? '??';

  const canEdit = currentUser?.id === req.raisedById
    || ['lead','regional_mgr','admin'].includes(currentUser?.role);

  const nextStatuses = REQUEST_STATUSES.filter(s => s.id !== req.status && req.status !== 'resolved');

  return (
    <div style={{
      width:440, flexShrink:0, borderLeft:'1px solid #e8e8e8', background:'white',
      display:'flex', flexDirection:'column', height:'100%', overflowY:'auto',
    }}>
      {/* Header */}
      <div style={{ padding:'20px 24px 16px', borderBottom:'1px solid #f2f2f2', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, marginBottom:12 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:11, fontWeight:600, color:'#9e9e9e', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 }}>
              {req.id}
            </div>
            <div style={{ fontSize:16, fontWeight:700, color:'#1b1b1b', lineHeight:1.35 }}>{req.subject}</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#9e9e9e', fontSize:18, padding:4, lineHeight:1, flexShrink:0 }}>
            <i className="bi-x-lg"/>
          </button>
        </div>
        {/* Badges */}
        <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
          <span style={{ padding:'4px 10px', borderRadius:128, fontSize:12, fontWeight:600, background:statusInfo?.bg, color:statusInfo?.color }}>
            {statusInfo?.label}
          </span>
          <span style={{ padding:'4px 10px', borderRadius:128, fontSize:12, fontWeight:500, background:'#f7f5f2', color:'#616161', display:'flex', alignItems:'center', gap:4 }}>
            <i className={team?.icon} style={{ fontSize:11 }}/>{team?.label}
          </span>
          <span style={{ padding:'4px 10px', borderRadius:128, fontSize:12, fontWeight:600, background:priorityBg[req.priority], color:priorityColors[req.priority] }}>
            {req.priority.charAt(0).toUpperCase()+req.priority.slice(1)}
          </span>
        </div>
      </div>

      {/* Meta */}
      <div style={{ padding:'16px 24px', borderBottom:'1px solid #f2f2f2', display:'grid', gridTemplateColumns:'1fr 1fr', gap:18 }}>
        {/* Raised by */}
        <div>
          <div style={{ fontSize:11, fontWeight:600, color:'#9e9e9e', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 }}>Raised By</div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ width:26, height:26, borderRadius:'50%', background:'#f3eff8', color:'#7c5cbf', fontSize:10, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{initials}</div>
            <div>
              <div style={{ fontSize:13, fontWeight:600, color:'#1b1b1b' }}>{raiser?.name.split(' ')[0]}</div>
              <div style={{ fontSize:11, color:'#9e9e9e' }}>{raiser?.team}</div>
            </div>
          </div>
        </div>

        {/* Created */}
        <div>
          <div style={{ fontSize:11, fontWeight:600, color:'#9e9e9e', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 }}>Created</div>
          <div style={{ fontSize:13, color:'#616161' }}>{relTime(req.createdAt)}</div>
          <div style={{ fontSize:11, color:'#9e9e9e', marginTop:2 }}>
            {new Date(req.createdAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
          </div>
        </div>

        {/* Linked task */}
        <div>
          <div style={{ fontSize:11, fontWeight:600, color:'#9e9e9e', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 }}>Linked Task</div>
          {req.linkedTaskId ? (
            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
              <i className={sourceIcons[req.linkedSource] ?? 'bi-link-45deg'} style={{ fontSize:12, color:'#9e9e9e' }}/>
              <span style={{ fontSize:13, fontWeight:500, color:'#1f74b3' }}>{req.linkedTaskId}</span>
            </div>
          ) : (
            <span style={{ fontSize:12, color:'#9e9e9e' }}>None</span>
          )}
        </div>

        {/* External ref */}
        <div>
          <div style={{ fontSize:11, fontWeight:600, color:'#9e9e9e', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 }}>External Ref</div>
          {editingRef ? (
            <div style={{ display:'flex', gap:6 }}>
              <input
                value={refVal} onChange={e => setRefVal(e.target.value)} autoFocus
                style={{ flex:1, padding:'4px 8px', border:'1px solid #e8e8e8', borderRadius:8, fontSize:13, outline:'none', fontFamily:'inherit' }}
              />
              <button onClick={() => { onUpdateRef(req.id, refVal); setEditingRef(false); }} style={{ padding:'4px 10px', borderRadius:128, fontSize:12, fontWeight:600, background:'#1b1b1b', color:'white', border:'none', cursor:'pointer' }}>Save</button>
            </div>
          ) : (
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ fontSize:13, color: req.externalRef ? '#1b1b1b' : '#9e9e9e', fontWeight: req.externalRef ? 500 : 400 }}>
                {req.externalRef ?? 'Not set'}
              </span>
              {canEdit && (
                <button onClick={() => setEditingRef(true)} style={{ background:'none', border:'none', cursor:'pointer', color:'#9e9e9e', fontSize:11, padding:2 }}>
                  <i className="bi-pencil"/>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {req.description && (
        <div style={{ padding:'16px 24px', borderBottom:'1px solid #f2f2f2' }}>
          <div style={{ fontSize:11, fontWeight:600, color:'#9e9e9e', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:8 }}>Description</div>
          <p style={{ fontSize:13, color:'#616161', lineHeight:1.6, margin:0 }}>{req.description}</p>
        </div>
      )}

      {/* Notes */}
      <div style={{ padding:'16px 24px', borderBottom:'1px solid #f2f2f2' }}>
        <div style={{ fontSize:11, fontWeight:600, color:'#9e9e9e', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:8 }}>Notes</div>
        {editingNotes ? (
          <div>
            <textarea
              value={notesVal} onChange={e => setNotesVal(e.target.value)} autoFocus
              rows={3}
              style={{ width:'100%', padding:'8px 10px', border:'1px solid #e8e8e8', borderRadius:10, fontSize:13, outline:'none', fontFamily:'inherit', resize:'vertical', boxSizing:'border-box' }}
            />
            <div style={{ display:'flex', gap:8, marginTop:8 }}>
              <button onClick={() => { onUpdateRef(req.id, undefined, notesVal); setEditingNotes(false); }} style={{ padding:'5px 14px', borderRadius:128, fontSize:12, fontWeight:600, background:'#1b1b1b', color:'white', border:'none', cursor:'pointer' }}>Save</button>
              <button onClick={() => setEditingNotes(false)} style={{ padding:'5px 14px', borderRadius:128, fontSize:12, fontWeight:500, background:'white', color:'#616161', border:'1px solid #e8e8e8', cursor:'pointer' }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8 }}>
            <p style={{ fontSize:13, color: req.notes ? '#616161' : '#9e9e9e', lineHeight:1.6, margin:0, fontStyle: req.notes ? 'normal' : 'italic' }}>
              {req.notes || 'No notes yet'}
            </p>
            {canEdit && (
              <button onClick={() => setEditingNotes(true)} style={{ background:'none', border:'none', cursor:'pointer', color:'#9e9e9e', fontSize:12, flexShrink:0, padding:2 }}>
                <i className="bi-pencil"/>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Status actions */}
      {canEdit && req.status !== 'resolved' && (
        <div style={{ padding:'16px 24px' }}>
          <div style={{ fontSize:11, fontWeight:600, color:'#9e9e9e', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:10 }}>Update Status</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
            {nextStatuses.map(s => (
              <button key={s.id} onClick={() => onUpdateStatus(req.id, s.id)} style={{
                padding:'7px 14px', borderRadius:128, fontSize:12, fontWeight:600, cursor:'pointer',
                border:`1px solid ${s.color}`, background:s.bg, color:s.color, transition:'opacity .15s',
              }}
                onMouseEnter={e => e.currentTarget.style.opacity='.8'}
                onMouseLeave={e => e.currentTarget.style.opacity='1'}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Outbound Queue ───────────────────────────────────────────────────────
export default function OutboundQueue({ requests, setRequests, user, onNewRequest, tasks, addToast }) {
  const [selReq, setSelReq]         = useState(null);
  const [teamFilter, setTeamFilter] = useState(null);
  const [statusFilter, setStatus]   = useState(null);
  const [search, setSearch]         = useState('');

  const perms = useContext(PermissionsContext);
  const isAdmin = perms?.dataScope==='all_tasks';
  const isLead = perms?.dataScope==='team_tasks';

  const visible = useMemo(() => {
    let list = [...requests];

    // Role-based visibility
    if (!isAdmin) {
      if (isLead) {
        list = list.filter(r => {
          const raiser = MEMBERS.find(m => m.id === r.raisedById);
          return raiser?.team === user?.team;
        });
      } else {
        list = list.filter(r => r.raisedById === user?.id);
      }
    }

    if (teamFilter) list = list.filter(r => r.toTeam === teamFilter);
    if (statusFilter) list = list.filter(r => r.status === statusFilter);
    if (search.trim()) list = list.filter(r =>
      r.subject.toLowerCase().includes(search.toLowerCase()) ||
      r.id.toLowerCase().includes(search.toLowerCase()) ||
      r.externalRef?.toLowerCase().includes(search.toLowerCase())
    );

    // Sort: open/in_progress first, then by created desc
    const order = { open:0, in_progress:1, waiting:2, resolved:3, rejected:4 };
    return list.sort((a,b) => (order[a.status]??5) - (order[b.status]??5) || new Date(b.createdAt) - new Date(a.createdAt));
  }, [requests, user, isAdmin, isLead, teamFilter, statusFilter, search]);

  const open   = visible.filter(r => r.status !== 'resolved' && r.status !== 'rejected').length;
  const total  = visible.length;

  // Shared helper — optimistic update + backend sync with automatic rollback
  // on failure. Keeps the UI responsive while preventing "ghost saves" when
  // the server rejects the write.
  const persistRequestUpdate = (id, patch) => {
    const prev = requests.find(r => r.id === id);
    if (!prev) return;
    const now = new Date().toISOString();
    // Optimistic
    setRequests(list => list.map(r => r.id === id ? { ...r, ...patch, updatedAt: now } : r));
    if (selReq?.id === id) setSelReq(cur => cur ? { ...cur, ...patch } : cur);
    // Persist
    apiUpdateRequest(id, patch).catch(err => {
      // Rollback
      setRequests(list => list.map(r => r.id === id ? prev : r));
      if (selReq?.id === id) setSelReq(prev);
      addToast?.('error', 'Save failed', err.message || 'Could not save change — reverted.');
    });
  };

  const handleUpdateStatus = (id, status) => {
    const patch = { status };
    if (status === 'resolved') patch.resolvedAt = new Date().toISOString();
    persistRequestUpdate(id, patch);
  };

  const handleUpdateRef = (id, externalRef, notes) => {
    const patch = {};
    if (externalRef !== undefined) patch.externalRef = externalRef;
    if (notes !== undefined) patch.notes = notes;
    if (Object.keys(patch).length === 0) return;
    persistRequestUpdate(id, patch);
  };

  const thStyle = {
    padding:'10px 14px', fontSize:11, fontWeight:600, color:'#616161',
    textTransform:'uppercase', letterSpacing:'.05em', textAlign:'left',
    whiteSpace:'nowrap', background:'#fafaf9',
  };

  // Teams actually used (for filter chips)
  const usedTeams = [...new Set(visible.map(r => r.toTeam))];

  return (
    <div style={{ display:'flex', flex:1, overflow:'hidden', height:'100%' }}>
      {/* Main */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Page header */}
        <div style={{ padding:'24px 24px 0', background:'white', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:16 }}>
            <div>
              <h1 style={{ fontSize:24, fontWeight:700, color:'#1b1b1b', margin:0 }}>Outbound Requests</h1>
              <p style={{ fontSize:14, color:'#616161', margin:'5px 0 0' }}>
                <span style={{ fontWeight:600, color:'#1b1b1b' }}>{open}</span> open &middot; {total} total
              </p>
            </div>
            <button onClick={onNewRequest} style={{
              display:'inline-flex', alignItems:'center', gap:6, padding:'9px 18px',
              borderRadius:128, border:'none', background:'#1b1b1b', color:'white',
              fontSize:14, fontWeight:600, cursor:'pointer', flexShrink:0,
            }}
              onMouseEnter={e => e.currentTarget.style.opacity='.85'}
              onMouseLeave={e => e.currentTarget.style.opacity='1'}
            >
              <i className="bi-plus-lg" style={{ fontSize:13 }}/> New Request
            </button>
          </div>

          {/* Filters */}
          <div style={{ display:'flex', gap:8, paddingBottom:16, flexWrap:'wrap', alignItems:'center' }}>
            {/* Search */}
            <div style={{ position:'relative' }}>
              <i className="bi-search" aria-hidden="true" style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'#9e9e9e', fontSize:13, pointerEvents:'none' }}/>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search requests…"
                role="searchbox"
                aria-label="Search outbound requests"
                style={{ padding:'7px 10px 7px 30px', border:'1px solid #e8e8e8', borderRadius:128, fontSize:13, outline:'none', width:200 }}
              />
            </div>

            {/* Team chips */}
            <button onClick={() => setTeamFilter(null)} aria-pressed={!teamFilter} aria-label="Filter by team: all teams" style={{
              padding:'5px 14px', borderRadius:128, fontSize:12, fontWeight:500, cursor:'pointer',
              border:'1px solid', borderColor:!teamFilter?'#1b1b1b':'#e8e8e8',
              background:!teamFilter?'#1b1b1b':'white', color:!teamFilter?'white':'#616161',
            }}>All Teams</button>
            {OUTBOUND_TEAMS.filter(t => usedTeams.includes(t.id) || !usedTeams.length).map(t => (
              <button key={t.id} onClick={() => setTeamFilter(teamFilter===t.id?null:t.id)} aria-pressed={teamFilter===t.id} aria-label={`Filter by team: ${t.label}`} style={{
                display:'flex', alignItems:'center', gap:5,
                padding:'5px 14px', borderRadius:128, fontSize:12, fontWeight:500, cursor:'pointer',
                border:'1px solid', transition:'all .15s',
                borderColor: teamFilter===t.id?'#1f74b3':'#e8e8e8',
                background: teamFilter===t.id?'#e8f0fe':'white',
                color: teamFilter===t.id?'#1f74b3':'#616161',
              }}>
                <i className={t.icon} aria-hidden="true" style={{ fontSize:11 }}/>{t.label}
              </button>
            ))}

            {/* Divider */}
            <div aria-hidden="true" style={{ width:1, height:20, background:'#e8e8e8' }}/>

            {/* Status chips */}
            {REQUEST_STATUSES.map(s => (
              <button key={s.id} onClick={() => setStatus(statusFilter===s.id?null:s.id)} aria-pressed={statusFilter===s.id} aria-label={`Filter by status: ${s.label}`} style={{
                padding:'5px 14px', borderRadius:128, fontSize:12, fontWeight:500, cursor:'pointer',
                border:'1px solid', transition:'all .15s',
                borderColor: statusFilter===s.id?s.color:'#e8e8e8',
                background: statusFilter===s.id?s.bg:'white',
                color: statusFilter===s.id?s.color:'#616161',
              }}>{s.label}</button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div style={{ flex:1, overflowY:'auto', paddingBottom:24 }}>
          {visible.length === 0 ? (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:280, color:'#9e9e9e' }}>
              <i className="bi-send" style={{ fontSize:36, marginBottom:12, opacity:.4 }}/>
              <div style={{ fontSize:15, fontWeight:600 }}>No outbound requests</div>
              <div style={{ fontSize:13, marginTop:4 }}>Requests your team raises to other teams will appear here</div>
            </div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ borderBottom:'1px solid #e8e8e8' }}>
                  <th style={{ ...thStyle, width:'30%' }}>Subject</th>
                  <th style={thStyle}>To Team</th>
                  <th style={thStyle}>Source</th>
                  <th style={thStyle}>Raised By</th>
                  <th style={thStyle}>Created</th>
                  <th style={thStyle}>Ext. Ref</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(req => {
                  const team       = OUTBOUND_TEAMS.find(t => t.id === req.toTeam);
                  const statusInfo = REQUEST_STATUSES.find(s => s.id === req.status);
                  const raiser     = MEMBERS.find(m => m.id === req.raisedById);
                  const initials   = raiser?.name.split(' ').map(w=>w[0]).join('').slice(0,2) ?? '??';
                  const isSelected = selReq?.id === req.id;

                  return (
                    <tr
                      key={req.id}
                      onClick={() => setSelReq(isSelected ? null : req)}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
                      aria-label={`${req.subject} — ${statusInfo?.label || req.status}`}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelReq(isSelected ? null : req);
                        }
                      }}
                      style={{
                        borderBottom:'1px solid #f2f2f2', cursor:'pointer', transition:'background .1s',
                        background: isSelected ? '#f3eff8' : 'white',
                      }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background='#f9f8f6'; }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background='white'; }}
                    >
                      {/* Subject */}
                      <td style={{ padding:'13px 14px' }}>
                        <div style={{ fontSize:14, fontWeight:600, color:'#1b1b1b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:260 }}>
                          {req.subject}
                        </div>
                        <div style={{ fontSize:11, color:'#9e9e9e', marginTop:2 }}>{req.id}</div>
                      </td>

                      {/* To Team */}
                      <td style={{ padding:'13px 14px' }}>
                        <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:13, color:'#616161' }}>
                          <i className={team?.icon} style={{ fontSize:12 }}/>{team?.label}
                        </span>
                      </td>

                      {/* Source */}
                      <td style={{ padding:'13px 14px' }}>
                        {req.linkedSource ? (
                          <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:12, color:'#9e9e9e' }}>
                            <i className={sourceIcons[req.linkedSource] ?? 'bi-link-45deg'}/>
                            {req.linkedTaskId}
                          </span>
                        ) : (
                          <span style={{ fontSize:12, color:'#d0d0d0' }}>—</span>
                        )}
                      </td>

                      {/* Raised by */}
                      <td style={{ padding:'13px 14px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                          <div style={{ width:24, height:24, borderRadius:'50%', background:'#f3eff8', color:'#7c5cbf', fontSize:10, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{initials}</div>
                          <span style={{ fontSize:13, color:'#1b1b1b' }}>{raiser?.name.split(' ')[0]}</span>
                        </div>
                      </td>

                      {/* Created */}
                      <td style={{ padding:'13px 14px' }}>
                        <div style={{ fontSize:13, color:'#616161' }}>{relTime(req.createdAt)}</div>
                      </td>

                      {/* Ext ref */}
                      <td style={{ padding:'13px 14px' }}>
                        {req.externalRef
                          ? <span style={{ fontSize:12, fontWeight:500, color:'#1b1b1b', fontFamily:'monospace', background:'#f7f5f2', padding:'2px 8px', borderRadius:6 }}>{req.externalRef}</span>
                          : <span style={{ fontSize:12, color:'#d0d0d0' }}>—</span>
                        }
                      </td>

                      {/* Status */}
                      <td style={{ padding:'13px 14px' }}>
                        <span style={{ padding:'3px 10px', borderRadius:128, fontSize:11, fontWeight:600, background:statusInfo?.bg, color:statusInfo?.color, whiteSpace:'nowrap' }}>
                          {statusInfo?.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selReq && (
        <RequestDetail
          req={selReq}
          currentUser={user}
          onClose={() => setSelReq(null)}
          onUpdateStatus={handleUpdateStatus}
          onUpdateRef={handleUpdateRef}
        />
      )}
    </div>
  );
}
