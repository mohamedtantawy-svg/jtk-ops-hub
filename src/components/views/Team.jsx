import { useState, useContext, useMemo } from 'react';
import { PermissionsContext, IntegrationsContext } from '../../App';
import { TEAM_MEMBERS, MEMBERS_BY_EMAIL, getDirectReports, getAllReports } from '../../data/members';
import { FLAGS, SLA_MINS } from '../../data/constants';
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

const Team = ({ user, tasks, setTask, setView, realUser, onImpersonate, impersonating }) => {
  const [expanded, setExpanded] = useState(new Set());
  const [regionFilter, setRegionFilter] = useState('all');
  const [eodOpen, setEodOpen] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const [hoveredRow, setHoveredRow] = useState(null);
  const [showParentalLeave, setShowParentalLeave] = useState(false);

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
    const breached = agentTasks.filter(t => t.slaBreached || t.isAlert).length;
    if (breached >= 1) return 'red';
    const atHighRisk = agentTasks.some(t => {
      const lim = (SLA_MINS && SLA_MINS[t.type]) || 1440;
      const pct = (t.minutesAgo || 0) / lim;
      return pct > 0.8;
    });
    if (atHighRisk) return 'red';
    const atMedRisk = agentTasks.some(t => {
      const lim = (SLA_MINS && SLA_MINS[t.type]) || 1440;
      const pct = (t.minutesAgo || 0) / lim;
      return pct >= 0.5;
    });
    if (atMedRisk || agentTasks.some(t => t.slaAtRisk)) return 'yellow';
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
  const userMember = MEMBERS_BY_EMAIL[userEmail];

  // For the "Login as" feature: who can be impersonated
  const realUserEmail = (realUser?.email || '').toLowerCase();
  const realUserMember = MEMBERS_BY_EMAIL[realUserEmail];
  const realUserAllReports = useMemo(() => {
    if (!realUserMember) return new Set();
    if (['admin', 'regional_manager', 'team_lead'].includes(realUserMember.access)) {
      return new Set(getAllReports(realUserEmail));
    }
    return new Set();
  }, [realUserEmail, realUserMember]);

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
    // Admin sees their direct reports (the RMs)
    // RM/TL sees their direct reports
    // Agent sees nothing (no reports)
    let directReports = getDirectReports(userEmail);

    // Apply region filter
    if (regionFilter !== 'all') {
      directReports = directReports.filter(m => {
        if (regionFilter === 'LATAM + NAM') return m.team === 'LATAM + NAM' || m.team === 'LATAM' || m.team === 'NAM';
        return m.team === regionFilter;
      });
    }
    return directReports;
  }, [userEmail, userMember, regionFilter]);

  // Compute overall stats for KPI cards — user + all emails under them
  const allReportEmails = useMemo(() => [userEmail, ...getAllReports(userEmail)], [userEmail]);
  const ov = useMemo(() => statsByEmails(allReportEmails), [allReportEmails, ns]);

  // EOD summary
  const resolvedToday = tasks.filter(t => t.status === 'resolved').length;
  const stillOpen = tasks.filter(t => t.status !== 'resolved').length;
  const slaBreached = tasks.filter(t => t.slaBreached || t.isAlert).length;
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
    const subReports = getDirectReports(email);
    const hasSubReports = subReports.length > 0;
    const isExpanded = expanded.has(email);
    const isManager = hasSubReports;
    const badge = ACCESS_BADGE[member.access] || ACCESS_BADGE.agent;
    const isHovered = hoveredRow === email;

    // Stats: for managers, aggregate self + all reports; for agents, just self
    const reportEmails = hasSubReports ? [email, ...getAllReports(email)] : [email];
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
            gridTemplateColumns: '1fr 56px 64px 64px 64px 64px 80px',
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
          <span style={{ textAlign: 'center', fontSize: 11, color: '#616161', background: '#f7f5f2', borderRadius: 128, padding: '2px 8px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {member.team}
          </span>
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
              Viewing as {MEMBERS_BY_EMAIL[impersonating.toLowerCase()]?.name || impersonating}
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

        {/* Region filter for admins / regional managers */}
        {(isAdmin || (userMember && userMember.access === 'regional_manager')) && (
          <div style={{ display: 'flex', background: '#f7f5f2', borderRadius: 128, padding: 3, gap: 2, marginBottom: 16, width: 'fit-content', flexWrap: 'wrap' }}>
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
          <div role="row" style={{ padding: '12px 16px', borderBottom: '1px solid #f2f2f2', display: 'grid', gridTemplateColumns: '1fr 56px 64px 64px 64px 64px 80px', gap: 8, background: '#fafaf9' }}>
            {['Manager / Agent', 'Team', 'Open', 'New', 'In prog', 'Pause', 'Health'].map(h => (
              <span
                key={h}
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
    </div>
  );
};

export default Team;
