import { useState, useContext, useMemo, useRef, useEffect, useCallback } from 'react';
import { PermissionsContext, IntegrationsContext } from '../../App';
import { TEAM_MEMBERS, MEMBERS_BY_EMAIL, getDirectReports, getAllReports } from '../../data/members';
import { FLAGS, SLA_MINS } from '../../data/constants';
import { slaInfo } from '../../utils/helpers';
import Avatar from '../ui/Avatar';
import PageHeader from '../ui/PageHeader';

// ── Parental Leave mock data ────────────────────────────────────────────────
const PARENTAL_LEAVE_DATA=[
  {id:'pl-1',name:'Sophie Muller',    country:'DE',region:'EMEA',type:'Maternity',startDate:'2026-01-15',endDate:'2026-07-15',status:'Active',   handover:'Complete'},
  {id:'pl-2',name:'James Okafor',     country:'DE',region:'EMEA',type:'Paternity',startDate:'2026-04-01',endDate:'2026-04-28',status:'Upcoming', handover:'Pending'},
  {id:'pl-3',name:'Mei Lin',          country:'SG',region:'APAC',type:'Maternity',startDate:'2025-12-01',endDate:'2026-03-28',status:'Returning soon',handover:'Complete'},
  {id:'pl-4',name:'Charlotte Dubois', country:'FR',region:'EMEA',type:'Maternity',startDate:'2025-09-10',endDate:'2026-03-10',status:'Returned', handover:'Complete'},
  {id:'pl-5',name:'Tom Walsh',        country:'FR',region:'EMEA',type:'Paternity',startDate:'2026-05-12',endDate:'2026-06-09',status:'Upcoming', handover:'Pending'},
  {id:'pl-6',name:'Yuki Tanaka',      country:'AU',region:'APAC',type:'Maternity',startDate:'2026-02-01',endDate:'2026-08-01',status:'Active',   handover:'Complete'},
  {id:'pl-7',name:'Lena Schmidt',     country:'DE',region:'EMEA',type:'Maternity',startDate:'2025-11-20',endDate:'2026-04-05',status:'Returning soon',handover:'Pending'},
  {id:'pl-8',name:'Anika Patel',      country:'UK',region:'EMEA',type:'Maternity',startDate:'2026-06-01',endDate:'2026-12-01',status:'Upcoming', handover:'Pending'},
];

const PL_STATUS_COLORS={
  'Upcoming':     {bg:'#e8f0fe',color:'#1f74b3'},
  'Active':       {bg:'#f3eff8',color:'#7c3aed'},
  'Returning soon':{bg:'#fff8e6',color:'#ed8d00'},
  'Returned':     {bg:'#e8f5e3',color:'#29811e'},
};

const REGIONS = [
  { id:'all',        label:'All Regions' },
  { id:'EMEA',       label:'EMEA' },
  { id:'APAC',       label:'APAC' },
  { id:'LATAM',      label:'LATAM' },
  { id:'NAM',        label:'NAM' },
  { id:'LATAM + NAM',label:'LATAM + NAM' },
];

const ACCESS_BADGE = {
  admin:            { label:'Admin',        bg:'#ffe2de', color:'#d42d35' },
  regional_manager: { label:'Regional Mgr', bg:'#e8f0fe', color:'#1f74b3' },
  team_lead:        { label:'Team Lead',    bg:'#f3eff8', color:'#7c3aed' },
  agent:            { label:'Agent',        bg:'#f7f5f2', color:'#616161' },
};

const TEAM_OPTIONS = ['All', 'EMEA', 'APAC', 'LATAM', 'NAM', 'LATAM + NAM'];
const ROLE_OPTIONS = ['agent', 'team_lead', 'regional_manager', 'admin'];
const REGION_OPTIONS = ['EMEA', 'APAC', 'LATAM', 'NAM', 'LATAM + NAM'];

const EMPTY_FORM = { name: '', email: '', team: 'EMEA', role: 'agent', region: 'EMEA', country: '' };

const Team = ({ user, tasks, setTask, setView, realUser, onImpersonate, impersonating }) => {
  const [expanded, setExpanded] = useState(new Set());
  const [regionFilter, setRegionFilter] = useState('all');
  const [eodOpen, setEodOpen] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const [hoveredRow, setHoveredRow] = useState(null);
  const [showParentalLeave, setShowParentalLeave] = useState(false);

  // ── User management state ───────────────────────────────────────────────
  const [localMembers, setLocalMembers] = useState(TEAM_MEMBERS);
  const [onLeaveSet, setOnLeaveSet] = useState(() => {
    try { const d = localStorage.getItem('ops_hub_on_leave'); return d ? new Set(JSON.parse(d)) : new Set(); } catch(e) { return new Set(); }
  });
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ ...EMPTY_FORM });
  const [actionMenuOpen, setActionMenuOpen] = useState(null); // email of member whose menu is open
  const [editAllocEmail, setEditAllocEmail] = useState(null); // email of member being re-allocated
  const [confirmRemove, setConfirmRemove] = useState(null);   // email of member pending removal
  const actionMenuRef = useRef(null);

  // Close action menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target)) {
        setActionMenuOpen(null);
      }
    };
    if (actionMenuOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [actionMenuOpen]);

  // ── Local member helpers (mirror the module helpers but on localMembers) ──
  const localMembersByEmail = useMemo(() =>
    Object.fromEntries(localMembers.map(m => [m.email, m])), [localMembers]);

  const localGetDirectReports = useCallback((email) => {
    if (!email) return [];
    const e = email.toLowerCase();
    return localMembers.filter(m => m.managerEmail === e);
  }, [localMembers]);

  const localGetAllReports = useCallback((email) => {
    if (!email) return [];
    const reports = new Set();
    const queue = [email.toLowerCase()];
    while (queue.length > 0) {
      const mgr = queue.shift();
      for (const m of localMembers) {
        if (m.managerEmail === mgr && !reports.has(m.email)) {
          reports.add(m.email);
          queue.push(m.email);
        }
      }
    }
    return [...reports];
  }, [localMembers]);

  // ── Add Member handler ──────────────────────────────────────────────────
  const handleAddMember = () => {
    if (!addForm.name.trim() || !addForm.email.trim()) return;
    const initials = addForm.name.trim().split(' ').map(n => n[0] || '').join('').slice(0, 2).toUpperCase();
    const newMember = {
      email: addForm.email.trim().toLowerCase(),
      name: addForm.name.trim(),
      initials,
      title: 'HR Experience Specialist',
      access: addForm.role,
      managerEmail: (user?.email || '').toLowerCase(),
      team: addForm.team,
      service: 'EOR',
      startDate: new Date().toISOString().slice(0, 10),
      country: addForm.country.trim() || null,
    };
    setLocalMembers(prev => [...prev, newMember]);
    setAddForm({ ...EMPTY_FORM });
    setShowAddModal(false);
  };

  // ── Change allocation handler ───────────────────────────────────────────
  const handleChangeAllocation = (email, newTeam) => {
    setLocalMembers(prev => prev.map(m => m.email === email ? { ...m, team: newTeam } : m));
    setEditAllocEmail(null);
    setActionMenuOpen(null);
  };

  // ── Toggle on-leave ─────────────────────────────────────────────────────
  const handleToggleLeave = (email) => {
    setOnLeaveSet(prev => {
      const next = new Set(prev);
      next.has(email) ? next.delete(email) : next.add(email);
      try { localStorage.setItem('ops_hub_on_leave', JSON.stringify([...next])); } catch(e) {}
      return next;
    });
    setActionMenuOpen(null);
  };

  // ── Remove member ───────────────────────────────────────────────────────
  const handleRemoveMember = (email) => {
    setLocalMembers(prev => prev.filter(m => m.email !== email));
    setConfirmRemove(null);
    setActionMenuOpen(null);
  };

  const perms = useContext(PermissionsContext);
  const { deelData } = useContext(IntegrationsContext);
  const isAdmin = perms?.dataScope === 'all_tasks';

  // Non-slack tasks for stats
  const ns = useMemo(() => tasks.filter(t => t.source !== 'slack'), [tasks]);

  // ── Stat helpers (email-based) ──────────────────────────────────────────
  const statsByEmails = (emails) => {
    const emailSet = new Set(emails.map(e => e.toLowerCase()));
    const ts = ns.filter(t => emailSet.has((t.assigneeEmail || '').toLowerCase()) && t.status !== 'resolved');
    return {
      total: ts.length,
      n: ts.filter(t => t.status === 'new').length,
      ip: ts.filter(t => t.status === 'in_progress').length,
      w: ts.filter(t => t.status === 'waiting').length,
    };
  };

  // SLA health for an agent email
  const slaHealth = (email) => {
    const e = email.toLowerCase();
    const agentTasks = ns.filter(t => (t.assigneeEmail || '').toLowerCase() === e && t.status !== 'resolved');
    if (agentTasks.length === 0) return 'green';
    const breached = agentTasks.some(t => { const s = slaInfo(t); return (s && s.breach) || t.isAlert; });
    if (breached) return 'red';
    const atRisk = agentTasks.some(t => { const s = slaInfo(t); return s && !s.ok && !s.breach; });
    if (atRisk) return 'yellow';
    return 'green';
  };

  const slaDot = (health) => {
    const color = health === 'red' ? 'var(--red-solid, #dc2626)' : health === 'yellow' ? 'var(--orange-solid, #d97706)' : 'var(--green-solid, #16a34a)';
    const statusLabel = health === 'red' ? 'SLA Breached' : health === 'yellow' ? '1-2 at risk' : 'Healthy';
    return <span title={statusLabel} style={{ width: 10, height: 10, borderRadius: 5, background: color, display: 'inline-block', flexShrink: 0 }} />;
  };

  const toggle = id => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ── Build hierarchy tree from current user ──────────────────────────────
  // Get direct reports of the effective user
  const userEmail = (user?.email || '').toLowerCase();
  const userMember = localMembersByEmail[userEmail];

  // For the "Login as" feature: who can be impersonated
  const realUserEmail = (realUser?.email || '').toLowerCase();
  const realUserMember = localMembersByEmail[realUserEmail];
  const realUserAllReports = useMemo(() => {
    if (!realUserMember) return new Set();
    if (['admin', 'regional_manager', 'team_lead'].includes(realUserMember.access)) {
      return new Set(localGetAllReports(realUserEmail));
    }
    return new Set();
  }, [realUserEmail, realUserMember, localGetAllReports]);

  const canLoginAs = (targetEmail) => {
    if (!realUserMember) return false;
    if (!['admin', 'regional_manager', 'team_lead'].includes(realUserMember.access)) return false;
    const te = targetEmail.toLowerCase();
    if (te === (impersonating || '').toLowerCase()) return false;
    return realUserAllReports.has(te);
  };

  // Build the tree of people to display
  const visibleMembers = useMemo(() => {
    if (!userMember) return [];
    let directReports = localGetDirectReports(userEmail);

    // Apply region filter
    if (regionFilter !== 'all') {
      directReports = directReports.filter(m => {
        if (regionFilter === 'LATAM + NAM') return m.team === 'LATAM + NAM' || m.team === 'LATAM' || m.team === 'NAM';
        return m.team === regionFilter;
      });
    }
    return directReports;
  }, [userEmail, userMember, regionFilter, localGetDirectReports]);

  // Compute overall stats for KPI cards — user + all emails under them
  const allReportEmails = useMemo(() => [userEmail, ...localGetAllReports(userEmail)], [userEmail, localGetAllReports]);
  const ov = useMemo(() => statsByEmails(allReportEmails), [allReportEmails, ns]);

  // EOD summary
  const resolvedToday = tasks.filter(t => t.status === 'resolved').length;
  const stillOpen = tasks.filter(t => t.status !== 'resolved').length;
  const slaBreached = tasks.filter(t => { const s = slaInfo(t); return (s && s.breach) || t.isAlert; }).length;
  const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const copySummary = () => {
    const text = `Team EOD Report - ${dateStr}\nResolved: ${resolvedToday} | Open: ${stillOpen} | Breached: ${slaBreached}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    }).catch(() => {});
  };

  // ── Render a member row ─────────────────────────────────────────────────
  const renderMemberRow = (member, depth = 0) => {
    const email = member.email;
    const subReports = localGetDirectReports(email);
    const hasSubReports = subReports.length > 0;
    const isExpanded = expanded.has(email);
    const isManager = hasSubReports;
    const badge = ACCESS_BADGE[member.access] || ACCESS_BADGE.agent;
    const isHovered = hoveredRow === email;
    const isOnLeave = onLeaveSet.has(email);

    // Stats: for managers, aggregate self + all reports; for agents, just self
    const reportEmails = hasSubReports ? [email, ...localGetAllReports(email)] : [email];
    const s = statsByEmails(reportEmails);
    const health = slaHealth(email);

    // Region filter for sub-reports
    let filteredSubReports = subReports;
    if (regionFilter !== 'all') {
      filteredSubReports = subReports.filter(m => {
        if (regionFilter === 'LATAM + NAM') return m.team === 'LATAM + NAM' || m.team === 'LATAM' || m.team === 'NAM';
        return m.team === regionFilter;
      });
    }

    const showLoginAs = canLoginAs(email) && onImpersonate;
    const isMenuOpen = actionMenuOpen === email;
    const isEditingAlloc = editAllocEmail === email;

    return (
      <div key={email}>
        {/* Main row */}
        <div
          onClick={() => isManager && toggle(email)}
          style={{
            padding: '12px 16px',
            minHeight: 48,
            borderBottom: '1px solid #f2f2f2',
            display: 'grid',
            gridTemplateColumns: '1fr 56px 64px 64px 64px 64px 80px 32px',
            gap: 8,
            alignItems: 'center',
            cursor: isManager ? 'pointer' : 'default',
            background: isManager
              ? (isExpanded ? '#f9f8f6' : (isHovered ? '#f9f8f6' : 'white'))
              : (isHovered ? '#fafaf9' : depth > 0 ? '#fafaf9' : 'white'),
            transition: 'background 0.1s',
            position: 'relative',
          }}
          onMouseEnter={e => { if (isManager) e.currentTarget.style.background = '#f9f8f6'; setHoveredRow(email); }}
          onMouseLeave={e => { if (isManager) e.currentTarget.style.background = isExpanded ? '#f9f8f6' : 'white'; else if (depth > 0) e.currentTarget.style.background = '#fafaf9'; else e.currentTarget.style.background = 'white'; setHoveredRow(null); }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: depth > 0 ? 7 : 10, paddingLeft: depth > 0 ? 24 * depth : 0 }}>
            {depth > 0 && <div style={{ width: 1, height: 18, background: '#e8e8e8', marginRight: 7 }} />}
            <Avatar name={member.name} initials={member.initials} size={isManager ? 30 : 24} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: isManager ? 700 : 500, color: '#1b1b1b', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {member.name}
                <span style={{ background: badge.bg, color: badge.color, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 128 }}>{badge.label}</span>
                {isOnLeave && (
                  <span style={{ background: '#fff8e6', color: '#ed8d00', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 128 }}>On Leave</span>
                )}
                {isManager && (
                  <span style={{ fontSize: 10, color: '#9e9e9e', fontWeight: 500 }}>
                    {subReports.length} report{subReports.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: '#616161', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {member.title}
              </div>
            </div>
            {isManager && (
              <i className={`bi-chevron-${isExpanded ? 'up' : 'down'}`} style={{ fontSize: 11, color: '#9e9e9e', marginLeft: 4, flexShrink: 0 }} />
            )}
            {showLoginAs && isHovered && (
              <button
                onClick={(e) => { e.stopPropagation(); onImpersonate(email); }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 10px', borderRadius: 128,
                  border: '1px solid #7c3aed33',
                  background: '#7c3aed',
                  color: 'white',
                  fontSize: 10, fontWeight: 700,
                  cursor: 'pointer', flexShrink: 0,
                  transition: 'all .15s',
                  whiteSpace: 'nowrap',
                }}
                title={`Login as ${member.name}`}
              >
                <i className="bi-box-arrow-in-right" style={{ fontSize: 10 }} />
                Login as
              </button>
            )}
          </div>
          {/* Team badge — or inline allocation editor */}
          {isEditingAlloc ? (
            <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
              <select
                value={member.team}
                onChange={e => handleChangeAllocation(email, e.target.value)}
                onBlur={() => setEditAllocEmail(null)}
                autoFocus
                style={{
                  width: 72, padding: '2px 4px', fontSize: 11, borderRadius: 8,
                  border: '1px solid #7c3aed', outline: 'none', background: 'white',
                  color: '#1b1b1b', fontWeight: 600, cursor: 'pointer',
                }}
              >
                {TEAM_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          ) : (
            <span style={{ textAlign: 'center', fontSize: 11, color: '#616161', background: '#f7f5f2', borderRadius: 128, padding: '2px 8px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {member.team}
            </span>
          )}
          <span style={{ textAlign: 'center', fontSize: isManager ? 15 : 14, fontWeight: isManager ? 700 : 600, color: '#1b1b1b', fontVariantNumeric: 'tabular-nums' }}>{s.total}</span>
          <span style={{ textAlign: 'center', fontSize: isManager ? 14 : 13, fontWeight: isManager ? 600 : 500, color: '#1f74b3', fontVariantNumeric: 'tabular-nums' }}>{s.n}</span>
          <span style={{ textAlign: 'center', fontSize: isManager ? 14 : 13, fontWeight: isManager ? 600 : 500, color: '#ed8d00', fontVariantNumeric: 'tabular-nums' }}>{s.ip}</span>
          <span style={{ textAlign: 'center', fontSize: isManager ? 14 : 13, fontWeight: isManager ? 600 : 500, color: '#9e9e9e', fontVariantNumeric: 'tabular-nums' }}>{s.w}</span>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
            {slaDot(health)}
            <span style={{ fontSize: 10, color: health === 'red' ? '#d42d35' : health === 'yellow' ? '#ed8d00' : '#29811e', fontWeight: 600 }}>
              {health === 'red' ? 'Breached' : health === 'yellow' ? 'At Risk' : 'Healthy'}
            </span>
          </div>

          {/* Action menu (three dots) */}
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }} onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setActionMenuOpen(isMenuOpen ? null : email)}
              style={{
                width: 24, height: 24, borderRadius: 6, border: 'none',
                background: isMenuOpen ? '#f3eff8' : (isHovered ? '#f7f5f2' : 'transparent'),
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#616161', fontSize: 13, transition: 'background .1s',
                opacity: isHovered || isMenuOpen ? 1 : 0,
              }}
              title="Actions"
            >
              <i className="bi-three-dots-vertical" />
            </button>
            {isMenuOpen && (
              <div
                ref={actionMenuRef}
                style={{
                  position: 'absolute', top: 28, right: 0, zIndex: 100,
                  background: 'white', border: '1px solid #e8e8e8', borderRadius: 10,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.10)', minWidth: 160,
                  padding: '4px 0', overflow: 'hidden',
                }}
              >
                <button
                  onClick={() => { setEditAllocEmail(email); setActionMenuOpen(null); }}
                  style={{
                    width: '100%', padding: '8px 14px', border: 'none', background: 'transparent',
                    fontSize: 12, fontWeight: 500, color: '#1b1b1b', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f9f8f6'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <i className="bi-arrow-left-right" style={{ fontSize: 12, color: '#7c3aed' }} />
                  Edit Allocation
                </button>
                <button
                  onClick={() => handleToggleLeave(email)}
                  style={{
                    width: '100%', padding: '8px 14px', border: 'none', background: 'transparent',
                    fontSize: 12, fontWeight: 500, color: '#1b1b1b', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f9f8f6'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <i className={isOnLeave ? 'bi-person-check' : 'bi-calendar-x'} style={{ fontSize: 12, color: '#ed8d00' }} />
                  {isOnLeave ? 'End Leave' : 'Set On Leave'}
                </button>
                <div style={{ height: 1, background: '#f2f2f2', margin: '2px 0' }} />
                <button
                  onClick={() => setConfirmRemove(email)}
                  style={{
                    width: '100%', padding: '8px 14px', border: 'none', background: 'transparent',
                    fontSize: 12, fontWeight: 500, color: '#d42d35', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#fff5f5'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <i className="bi-person-x" style={{ fontSize: 12 }} />
                  Remove
                </button>
              </div>
            )}

            {/* Confirm remove dialog */}
            {confirmRemove === email && (
              <div
                style={{
                  position: 'absolute', top: 28, right: 0, zIndex: 110,
                  background: 'white', border: '1px solid #e8e8e8', borderRadius: 10,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 200,
                  padding: '14px 16px',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1b1b1b', marginBottom: 6 }}>Remove {member.name}?</div>
                <div style={{ fontSize: 11, color: '#616161', marginBottom: 12 }}>This will remove them from the team list.</div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setConfirmRemove(null)}
                    style={{
                      padding: '4px 12px', borderRadius: 128, border: '1px solid #e8e8e8',
                      background: 'white', fontSize: 11, fontWeight: 600, color: '#616161', cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleRemoveMember(email)}
                    style={{
                      padding: '4px 12px', borderRadius: 128, border: 'none',
                      background: '#d42d35', fontSize: 11, fontWeight: 700, color: 'white', cursor: 'pointer',
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Expandable sub-reports */}
        {isManager && (
          <div style={{ maxHeight: isExpanded ? '9999px' : 0, overflow: 'hidden', transition: isExpanded ? 'max-height 0.4s ease-in' : 'max-height 0.25s ease-out' }}>
            {filteredSubReports.map(sub => renderMemberRow(sub, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}>
      <PageHeader
        icon={isAdmin ? 'bi-building' : 'bi-people-fill'}
        iconBg="#f3eff8"
        iconColor="#1f74b3"
        title={isAdmin ? 'All Teams Overview' : 'My Team'}
        subtitle="Click a manager to expand their reports"
        right={impersonating && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 128, background: '#f3eff8', border: '1px solid #7c3aed33' }}>
            <i className="bi-person-badge" style={{ color: '#7c3aed', fontSize: 13 }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#7c3aed' }}>
              Viewing as {localMembersByEmail[impersonating.toLowerCase()]?.name || impersonating}
            </span>
            <button
              onClick={() => onImpersonate && onImpersonate(null)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 128, border: '1px solid #7c3aed', background: '#7c3aed', color: 'white', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
            >
              <i className="bi-x-lg" style={{ fontSize: 9 }} /> Exit
            </button>
          </div>
        )}
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
        {/* Deel API Connected banner */}
        {deelData?.isAvailable && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', marginBottom: 14, fontSize: 12 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
            <span style={{ fontWeight: 600, color: '#16a34a' }}>Deel API Connected</span>
            <span style={{ color: '#616161' }}>
              — {Array.isArray(deelData.people) ? deelData.people.length : 0} workers, {Array.isArray(deelData.timeOff) ? deelData.timeOff.length : 0} time-off requests
            </span>
          </div>
        )}

        {/* Region filter + Add Member button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          {(isAdmin || (userMember && userMember.access === 'regional_manager')) && (
            <div style={{ display: 'flex', background: '#f7f5f2', borderRadius: 128, padding: 3, gap: 2, width: 'fit-content', flexWrap: 'wrap' }}>
              {REGIONS.map(r => {
                const active = regionFilter === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => setRegionFilter(r.id)}
                    style={{
                      padding: '5px 14px', borderRadius: 128, border: 'none',
                      background: active ? 'white' : 'transparent',
                      color: active ? '#1b1b1b' : '#616161',
                      fontSize: 12, fontWeight: active ? 700 : 500,
                      cursor: 'pointer',
                      boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : undefined,
                      transition: 'all .15s',
                    }}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            style={{
              padding: '5px 14px', borderRadius: 128,
              border: '1px solid #e8e8e8',
              background: 'white',
              color: '#1b1b1b',
              fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              transition: 'all .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f9f8f6'; e.currentTarget.style.borderColor = '#d0d0d0'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#e8e8e8'; }}
          >
            <i className="bi-plus" style={{ fontSize: 13, fontWeight: 700 }} />
            Add Member
          </button>
        </div>

        {/* KPI cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 22 }}>
          {[
            { l: 'Total Open', v: ov.total, c: '#1b1b1b', icon: 'bi-inbox', bg: '#f7f5f2' },
            { l: 'New', v: ov.n, c: '#1f74b3', icon: 'bi-plus-circle', bg: '#e8f0fe' },
            { l: 'In Progress', v: ov.ip, c: '#ed8d00', icon: 'bi-arrow-repeat', bg: '#fff8e6' },
            { l: 'Alerts', v: tasks.filter(t => t.isAlert && t.status !== 'resolved').length, c: '#d42d35', icon: 'bi-exclamation-triangle-fill', bg: '#ffe2de' },
          ].map(s => (
            <div
              key={s.l}
              style={{
                background: 'var(--surface, white)',
                border: '1px solid var(--border, #e8e8e8)',
                borderRadius: 'var(--radius-2xl)',
                padding: 'var(--space-5)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                transition: 'box-shadow .15s',
              }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'}
              onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'}
            >
              <div style={{ width: 40, height: 40, background: s.bg, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                <i className={s.icon} style={{ color: s.c, fontSize: 17 }} />
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: s.c, fontVariantNumeric: 'tabular-nums' }}>{s.v}</div>
              <div style={{ fontSize: 12, color: '#616161', marginTop: 2, fontWeight: 500 }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* Team table */}
        <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e8e8e8', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div role="row" style={{ padding: '12px 16px', borderBottom: '1px solid #f2f2f2', display: 'grid', gridTemplateColumns: '1fr 56px 64px 64px 64px 64px 80px 32px', gap: 8, background: '#fafaf9' }}>
            {['Manager / Agent', 'Team', 'Open', 'New', 'In prog', 'Pause', 'Health', ''].map((h, i) => (
              <span
                key={h || `col-${i}`}
                role="columnheader"
                style={{ color: 'var(--text-muted, #9e9e9e)', fontSize: 13, fontWeight: 500, textTransform: 'none', letterSpacing: 'normal', textAlign: h === 'Manager / Agent' ? 'left' : 'center' }}
              >
                {h}
              </span>
            ))}
          </div>
          {visibleMembers.length === 0 && (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: '#9e9e9e' }}>
              <i className="bi-people" style={{ fontSize: 32, display: 'block', marginBottom: 12, opacity: 0.3 }} />
              <div style={{ fontSize: 14, fontWeight: 600 }}>No team members found</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Try adjusting the region filter above</div>
            </div>
          )}
          {visibleMembers.map(m => renderMemberRow(m, 0))}
        </div>

        {/* ── Parental Leave Tracker ──────────────────────────────────── */}
        {(() => {
          const plData = perms?.dataScope === 'all_tasks' && user?.region && user.region !== 'ALL'
            ? PARENTAL_LEAVE_DATA.filter(p => p.region === user.region)
            : PARENTAL_LEAVE_DATA;
          return (
            <div style={{ marginTop: 20, background: 'white', borderRadius: 16, border: '1px solid #e8e8e8', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <div
                onClick={() => setShowParentalLeave(v => !v)}
                style={{
                  padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer',
                  background: showParentalLeave ? '#f9f8f6' : 'white', transition: 'background .1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#f9f8f6'}
                onMouseLeave={e => e.currentTarget.style.background = showParentalLeave ? '#f9f8f6' : 'white'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, background: '#ffe2ef', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="bi-heart" style={{ color: '#e0457b', fontSize: 14 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--font-base)', fontWeight: 600, color: '#1b1b1b', display: 'flex', alignItems: 'center', gap: 5 }}>Parental Leave Tracker</div>
                    <div style={{ fontSize: 11, color: '#9e9e9e' }}>{plData.filter(p => p.status === 'Active' || p.status === 'Returning soon').length} currently on leave</div>
                  </div>
                </div>
                <i className={`bi-chevron-${showParentalLeave ? 'up' : 'down'}`} style={{ fontSize: 12, color: '#9e9e9e' }} />
              </div>
              {showParentalLeave && (
                <div style={{ borderTop: '1px solid #f2f2f2', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#fafaf9' }}>
                        {['Employee', 'Country', 'Type', 'Start date', 'End date', 'Status', 'Handover'].map(h => (
                          <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 13, fontWeight: 500, color: '#9e9e9e', textTransform: 'none', letterSpacing: 'normal', borderBottom: '1px solid #f2f2f2', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {plData.map((p, i) => {
                        const sc = PL_STATUS_COLORS[p.status] || PL_STATUS_COLORS['Upcoming'];
                        const isHandoverDone = p.handover === 'Complete';
                        return (
                          <tr
                            key={p.id}
                            style={{ borderBottom: i < plData.length - 1 ? '1px solid #f2f2f2' : 'none', transition: 'background .1s' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#fafaf9'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            <td style={{ padding: '11px 16px', fontWeight: 600, color: '#1b1b1b', whiteSpace: 'nowrap' }}>{p.name}</td>
                            <td style={{ padding: '11px 16px', color: '#616161', whiteSpace: 'nowrap' }}>{FLAGS[p.country] || '\u{1F310}'} {p.country}</td>
                            <td style={{ padding: '11px 16px', color: '#616161', whiteSpace: 'nowrap' }}>{p.type}</td>
                            <td style={{ padding: '11px 16px', color: '#616161', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{p.startDate}</td>
                            <td style={{ padding: '11px 16px', color: '#616161', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{p.endDate}</td>
                            <td style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
                              <span style={{ background: sc.bg, color: sc.color, padding: '3px 10px', borderRadius: 128, fontSize: 11, fontWeight: 700 }}>{p.status}</span>
                            </td>
                            <td style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
                              <span style={{ color: isHandoverDone ? '#29811e' : '#ed8d00', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                                {isHandoverDone ? '\u2713 Complete' : '\u26A0 Pending'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })()}

        {/* End of Day Summary */}
        <div style={{ marginTop: 20, background: 'white', borderRadius: 16, border: '1px solid #e8e8e8', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div
            onClick={() => setEodOpen(v => !v)}
            style={{
              padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer',
              background: eodOpen ? '#f9f8f6' : 'white', transition: 'background .1s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#f9f8f6'}
            onMouseLeave={e => e.currentTarget.style.background = eodOpen ? '#f9f8f6' : 'white'}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, background: '#fff8e6', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="bi-moon-stars-fill" style={{ color: '#ed8d00', fontSize: 14 }} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1b1b1b' }}>End of Day Summary</div>
                <div style={{ fontSize: 11, color: '#9e9e9e' }}>{dateStr}</div>
              </div>
            </div>
            <i className={`bi-chevron-${eodOpen ? 'up' : 'down'}`} style={{ fontSize: 12, color: '#9e9e9e' }} />
          </div>
          {eodOpen && (
            <div style={{ padding: '16px 20px', borderTop: '1px solid #f2f2f2' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 16 }}>
                {[
                  { l: 'Resolved Today', v: resolvedToday, c: '#29811e', icon: 'bi-check-circle-fill', bg: '#e8f5e3' },
                  { l: 'Still Open', v: stillOpen, c: '#ed8d00', icon: 'bi-clock-fill', bg: '#fff8e6' },
                  { l: 'SLA Breached', v: slaBreached, c: slaBreached > 0 ? '#d42d35' : '#29811e', icon: 'bi-exclamation-triangle-fill', bg: slaBreached > 0 ? '#ffe2de' : '#e8f5e3' },
                ].map(s => (
                  <div key={s.l} style={{ background: s.bg, borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 32, height: 32, background: 'white', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                      <i className={s.icon} style={{ color: s.c, fontSize: 14 }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: s.c, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{s.v}</div>
                      <div style={{ fontSize: 11, color: '#616161', marginTop: 2, fontWeight: 500 }}>{s.l}</div>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={copySummary}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 128,
                  border: '1px solid #e8e8e8',
                  background: copyDone ? '#e8f5e3' : 'white',
                  color: copyDone ? '#29811e' : '#1b1b1b',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all .2s',
                }}
              >
                <i className={copyDone ? 'bi-check2' : 'bi-clipboard'} style={{ fontSize: 12 }} />
                {copyDone ? 'Copied!' : 'Copy Summary'}
              </button>
            </div>
          )}
        </div>

      </div>

      {/* ── Add Member Modal ────────────────────────────────────────────── */}
      {showAddModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setShowAddModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'white', borderRadius: 16, padding: '28px 32px',
              width: 420, maxWidth: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,0.16)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1b1b1b' }}>Add Team Member</div>
              <button
                onClick={() => setShowAddModal(false)}
                style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: '#f7f5f2', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#616161', fontSize: 14 }}
              >
                <i className="bi-x-lg" />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Name */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Name</label>
                <input
                  type="text"
                  value={addForm.name}
                  onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Full name"
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                    fontSize: 13, color: '#1b1b1b', outline: 'none', boxSizing: 'border-box',
                  }}
                  onFocus={e => e.currentTarget.style.borderColor = '#7c3aed'}
                  onBlur={e => e.currentTarget.style.borderColor = '#e8e8e8'}
                />
              </div>

              {/* Email */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Email</label>
                <input
                  type="email"
                  value={addForm.email}
                  onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="name@deel.com"
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                    fontSize: 13, color: '#1b1b1b', outline: 'none', boxSizing: 'border-box',
                  }}
                  onFocus={e => e.currentTarget.style.borderColor = '#7c3aed'}
                  onBlur={e => e.currentTarget.style.borderColor = '#e8e8e8'}
                />
              </div>

              {/* Team + Role row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Team</label>
                  <select
                    value={addForm.team}
                    onChange={e => setAddForm(f => ({ ...f, team: e.target.value }))}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                      fontSize: 13, color: '#1b1b1b', background: 'white', cursor: 'pointer',
                    }}
                  >
                    {TEAM_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Role</label>
                  <select
                    value={addForm.role}
                    onChange={e => setAddForm(f => ({ ...f, role: e.target.value }))}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                      fontSize: 13, color: '#1b1b1b', background: 'white', cursor: 'pointer',
                    }}
                  >
                    {ROLE_OPTIONS.map(r => (
                      <option key={r} value={r}>{ACCESS_BADGE[r]?.label || r}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Region + Country row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Region</label>
                  <select
                    value={addForm.region}
                    onChange={e => setAddForm(f => ({ ...f, region: e.target.value }))}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                      fontSize: 13, color: '#1b1b1b', background: 'white', cursor: 'pointer',
                    }}
                  >
                    {REGION_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Country</label>
                  <input
                    type="text"
                    value={addForm.country}
                    onChange={e => setAddForm(f => ({ ...f, country: e.target.value }))}
                    placeholder="e.g. DE, US, SG"
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                      fontSize: 13, color: '#1b1b1b', outline: 'none', boxSizing: 'border-box',
                    }}
                    onFocus={e => e.currentTarget.style.borderColor = '#7c3aed'}
                    onBlur={e => e.currentTarget.style.borderColor = '#e8e8e8'}
                  />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
              <button
                onClick={() => setShowAddModal(false)}
                style={{
                  padding: '8px 18px', borderRadius: 128, border: '1px solid #e8e8e8',
                  background: 'white', fontSize: 13, fontWeight: 600, color: '#616161', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddMember}
                disabled={!addForm.name.trim() || !addForm.email.trim()}
                style={{
                  padding: '8px 18px', borderRadius: 128, border: 'none',
                  background: (!addForm.name.trim() || !addForm.email.trim()) ? '#e8e8e8' : '#7c3aed',
                  fontSize: 13, fontWeight: 700,
                  color: (!addForm.name.trim() || !addForm.email.trim()) ? '#9e9e9e' : 'white',
                  cursor: (!addForm.name.trim() || !addForm.email.trim()) ? 'not-allowed' : 'pointer',
                  transition: 'all .15s',
                }}
              >
                Add Member
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Team;
