import { useState, useEffect, useRef, useContext } from 'react';
import { PermissionsContext } from '../../App';
import { isApprover } from '../../data/approvers';
import Avatar from '../ui/Avatar';

// Temporary gate: these surfaces are hidden from everyone except the owner
// until the underlying features are production-ready. Remove the
// `restrictToEmail` props below once the app is ready to ship broadly.
const OWNER_EMAIL = 'mohamed.tantawy@deel.com';

/* Primary tabs always visible in the nav bar.
 * Team sits at the end: for non-owners it's the only secondary surface left
 * (everything else is owner-gated), so promoting it to the primary bar means
 * we can drop the More dropdown entirely for them. */
const PRIMARY_TABS = [
  { id: 'briefing',      icon: 'bi-house',            label: 'Home' },
  { id: 'my-queue',      icon: 'bi-inbox',            label: 'Queue' },
  { id: 'projects',      icon: 'bi-kanban',           label: 'Projects',      restrictToEmail: OWNER_EMAIL },
  { id: 'escalations',   icon: 'bi-arrow-up-circle',  label: 'Escalations',   badge: true,                       restrictToEmail: OWNER_EMAIL },
  // The 'Reports' (hr-reports) tab was retired 2026-05-02 — its scope
  // (HR reporting / bugs / quality issues) is now part of the HR Hub
  // tab as the `hr_reporting` flow. The view component, the
  // CREATE_ACTIONS entry, and the data source have all been removed.
  { id: 'announcements', icon: 'bi-megaphone',        label: 'Announcements' },
  // Approval queue and "My Requests" are surfaced inside the Announcements
  // view (as filter tabs) — we intentionally do not repeat them in the top
  // nav to avoid the double-entry confusion. The `approval-queue` view route
  // in App.jsx remains for deep-links / notifications / programmatic nav.
  { id: 'team',          icon: 'bi-people',           label: 'Team' },
  // Feedback board — open to every authenticated user so the whole team
  // can submit bugs + improvement ideas and vote on what matters.
  { id: 'feedback',      icon: 'bi-lightbulb',        label: 'Feedback' },
  // HR Hub — single intake for HR Requests, HR Reporting, Escalation
  // Zero, and Ops Hub Feedback. Open to every authenticated user.
  { id: 'hr-hub',        icon: 'bi-broadcast-pin',    label: 'HR Hub' },
  // Leaders Alerts — managerial-only surface for posting + acknowledging
  // alerts across the leadership group. Visibility is gated by
  // accessControl.MANAGERIAL_ONLY_VIEWS — agents are filtered out via
  // tabAllowed below.
  { id: 'leader-alerts', icon: 'bi-broadcast',        label: 'Leaders Alerts' },
];

/* Secondary tabs under More — all owner-only for now, so for non-owners
 * visibleMore is empty and the More button is suppressed entirely. */
const MORE_TABS = [
  { id: 'calendar',      icon: 'bi-calendar3',        label: 'Calendar',       restrictToEmail: OWNER_EMAIL },
  { id: 'knowledge-hub', icon: 'bi-book',             label: 'Knowledge Hub',  restrictToEmail: OWNER_EMAIL },
  { id: 'analytics',     icon: 'bi-bar-chart-line',   label: 'Analytics',      restrictToEmail: OWNER_EMAIL },
];

/* Quick-create actions in the + menu — each mapped to a required permission */
const CREATE_ACTIONS = [
  { icon: 'bi-plus-square',       label: 'New Task',         action: 'task',         desc: 'Create a queue task',         perm: 'can_create_task' },
  { icon: 'bi-arrow-up-circle',   label: 'New Escalation',   action: 'escalation',   desc: 'Raise an escalation',         perm: 'can_create_escalation' },
  { icon: 'bi-kanban',            label: 'New Project',      action: 'project',       desc: 'Start a project',             perm: 'can_create_project',          restrictToEmail: OWNER_EMAIL },
  { icon: 'bi-megaphone',         label: 'New Announcement', action: 'announcement',  desc: 'Post to the team' },
  // 'New Report' moved to HR Hub: use 'Submit to HR Hub' below and
  // pick `HR Reporting` from the picker.
  // No `perm` gate — every authenticated user can submit a bug / idea.
  { icon: 'bi-lightbulb',         label: 'New Feedback',     action: 'feedback',      desc: 'Report a bug or improvement' },
  // HR Hub intake — opens the 4-card picker. Every authenticated user
  // can submit; the picker shows the HR Request / HR Reporting /
  // Escalation Zero / Ops Hub Feedback options.
  { icon: 'bi-broadcast-pin',     label: 'Submit to HR Hub', action: 'hr-hub',        desc: 'HR Request, Report, Escalation Zero, or Feedback' },
  // Leaders Alerts intake — opens the single-flow composer modal.
  // Gated to managers via the `viewReq` check so agents don't see it.
  { icon: 'bi-broadcast',         label: 'New Leaders Alert', action: 'leader-alerts', desc: 'Quick alert visible to every manager', viewReq: 'leader-alerts' },
];

const DeelTopNav = ({
  view, setView, user,
  onSearch, notifs, markAllRead, onNotifClick,
  escalCount, onLogout,
  onCreateTask, onCreateEscalation, onCreateProject,
  onCreateAnnouncement, onCreateRequest, onCreateFeedback,
  onCreateHrHub,
  onCreateLeaderAlert,
  leaderAlertsBadge = 0,
  setSelTask, tasks,
}) => {
  // Manager on Call was previously rendered here as a pill in the right-side
  // icon bar. It's been moved to the BriefingView hero so it's front-and-center
  // on the home page for every role. DeelTopNav no longer owns that state.
  const perms = useContext(PermissionsContext);
  const [showMore,    setShowMore]    = useState(false);
  const [showCreate,  setShowCreate]  = useState(false);
  const [showNotifs,  setShowNotifs]  = useState(false);
  const [showUser,    setShowUser]    = useState(false);
  const [darkMode,    setDarkMode]    = useState(() => {
    try { return localStorage.getItem('ops_hub_theme') === 'dark'; } catch(e) { return false; }
  });

  const moreRef   = useRef(null);
  const createRef = useRef(null);
  const notifRef  = useRef(null);
  const userRef   = useRef(null);

  // Unified outside-click handler for all dropdowns (fixes QA #149)
  useEffect(() => {
    const h = (e) => {
      if (createRef.current && !createRef.current.contains(e.target)) setShowCreate(false);
      if (moreRef.current && !moreRef.current.contains(e.target)) setShowMore(false);
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifs(false);
      if (userRef.current && !userRef.current.contains(e.target)) setShowUser(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Cmd+K handled globally in App.jsx — no duplicate listener needed

  const toggleDark = () => {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
    try { localStorage.setItem('ops_hub_theme', next ? 'dark' : 'light'); } catch(e) {}
  };

  const handleCreate = (action) => {
    setShowCreate(false);
    if (action === 'task')         { onCreateTask?.(); }
    else if (action === 'escalation') { onCreateEscalation?.(); }
    else if (action === 'project')    { onCreateProject?.(); }
    else if (action === 'announcement') { onCreateAnnouncement?.(); setView('announcements'); }
    else if (action === 'request')    { onCreateRequest?.(); setView('my-queue'); }
    else if (action === 'feedback')   { setView('feedback'); onCreateFeedback?.(); }
    else if (action === 'hr-hub')     { onCreateHrHub?.(); }
    else if (action === 'leader-alerts') { onCreateLeaderAlert?.(); }
  };

  const unread = notifs ? notifs.filter(n => !n.read).length : 0;
  const notifCount = unread;

  // Filter tabs by user permissions — hide views the user can't access
  const emailLc = (user?.email || '').toLowerCase();
  const tabAllowed = (t) => {
    if (t.restrictToEmail) return emailLc === t.restrictToEmail.toLowerCase();
    if (t.approverOnly && !isApprover(user?.email)) return false;
    return !perms || perms.canView(t.id) !== false;
  };
  const visiblePrimary = PRIMARY_TABS.filter(tabAllowed);
  const visibleMore = MORE_TABS.filter(tabAllowed);
  const visibleCreate = CREATE_ACTIONS.filter(ca => {
    if (ca.restrictToEmail && emailLc !== ca.restrictToEmail.toLowerCase()) return false;
    if (ca.perm && !perms?.canDo(ca.perm)) return false;
    if (ca.viewReq && !perms?.canView(ca.viewReq)) return false;
    return true;
  });
  const isMoreActive = visibleMore.some(t => t.id === view);

  const dropdown = {
    position: 'absolute', top: 'calc(100% + 6px)',
    background: 'var(--surface)', border: '1px solid var(--border)',
    boxShadow: 'var(--shadow-lg)', zIndex: 300,
  };

  return (
    <div className="deel-topnav">
      {/* ── Left: Logo ─────────────────────────────── */}
      <div className="deel-logo" style={{ flexShrink: 0, lineHeight: 1, marginRight: 8 }}>
        <span style={{ fontFamily: "Inter, -apple-system, sans-serif", fontWeight: 800, fontSize: 24, color: 'var(--text)', letterSpacing: '-0.04em' }}>deel.</span>
      </div>

      {/* ── Center: Primary tabs ──────────────────────────── */}
      <div className="deel-nav-items">
        {visiblePrimary.map(tab => {
          const active = view === tab.id;
          // Escalations uses `badge` (red pill from escalCount). Approval-queue
          // counts are surfaced inside the Announcements view instead of in
          // the top nav — see AnnouncementsView for the pending-approval pill.
          let badge = 0;
          if (tab.badge && escalCount > 0) badge = escalCount;
          if (tab.id === 'leader-alerts' && leaderAlertsBadge > 0) badge = leaderAlertsBadge;
          return (
            <div key={tab.id} className={`deel-nav-item${active ? ' active' : ''}`}
              role="button"
              tabIndex={0}
              aria-current={active ? 'page' : undefined}
              onClick={() => setView(tab.id)}
              onKeyDown={e => e.key === 'Enter' && setView(tab.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', letterSpacing: '0.01em' }}>
              <i className={`bi ${tab.icon}`} style={{ fontSize: 14 }} title={tab.label}></i>
              <span className="deel-nav-item-label">{tab.label}</span>
              {badge > 0 && (
                <span className="deel-nav-item-badge" style={{
                  background: 'var(--red-solid)', color: 'white', fontSize: 10,
                  fontWeight: 700, padding: '1px 6px', borderRadius: 'var(--radius-pill)',
                  lineHeight: '14px', marginLeft: 2,
                }}>{badge}</span>
              )}
            </div>
          );
        })}

        {/* More dropdown — only rendered when there's something to put in it.
             For non-owners all MORE_TABS entries are owner-gated, so this is
             suppressed entirely and they just see the primary bar. */}
        {visibleMore.length > 0 && (
        <div ref={moreRef} style={{ position: 'relative' }}>
          <div className={`deel-nav-item${isMoreActive ? ' active' : ''}`}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && setShowMore(p => !p)}
            onClick={() => setShowMore(p => !p)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', letterSpacing: '0.01em' }}>
            <i className="bi bi-grid" style={{ fontSize: 14 }}></i>
            More
            <i className={`bi bi-chevron-${showMore ? 'up' : 'down'}`} style={{ fontSize: 10 }}></i>
          </div>
          {showMore && (
            <div style={{ ...dropdown, left: 0, borderRadius: 12, padding: '6px 0', minWidth: 200 }}>
              {visibleMore.map(mt => {
                const a = view === mt.id;
                return (
                  <div key={mt.id}
                    onClick={() => { setView(mt.id); setShowMore(false); }}
                    onMouseEnter={e => { if (!a) e.currentTarget.style.background = 'var(--surface-2)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = a ? 'var(--surface-2)' : 'transparent'; }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 16px', cursor: 'pointer', fontSize: 14,
                      fontWeight: a ? 600 : 400, color: a ? 'var(--purple)' : 'var(--text)',
                      background: a ? 'var(--surface-2)' : 'transparent', transition: 'background .12s',
                    }}>
                    <i className={`bi ${mt.icon}`} style={{ fontSize: 14, width: 20, textAlign: 'center', color: a ? 'var(--purple)' : 'var(--text-muted)' }}></i>
                    <span style={{ flex: 1 }}>{mt.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}
      </div>

      {/* ── Right: Figma icon bar ───────────────────────── */}
      <div className="deel-nav-right" style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>

        {/* Manager on Call relocated to BriefingView hero — see src/components/views/BriefingView.jsx */}

        {/* Apps grid */}
        <div ref={createRef} style={{ position: 'relative' }}>
          <button className="deel-icon-btn" onClick={() => setShowCreate(p => !p)} aria-label="Create new" title="Create new">
            <i className="bi bi-plus-lg" style={{ fontSize: 18, fontWeight: 700 }}></i>
          </button>
          {showCreate && (
            <div style={{ ...dropdown, right: 0, borderRadius: 14, padding: '8px 0', minWidth: 240, overflow: 'hidden' }}>
              <div style={{ padding: '6px 16px 8px', fontSize: 10, fontWeight: 700, color: 'var(--text-disabled)', letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase' }}>Quick Create</div>
              {visibleCreate.map(ca => (
                <div key={ca.action} role="button" tabIndex={0} aria-label={ca.label}
                  onClick={() => handleCreate(ca.action)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCreate(ca.action); } }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px', cursor: 'pointer', transition: 'background .12s' }}>
                  <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-lg)', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <i className={`bi ${ca.icon}`} style={{ fontSize: 14, color: 'var(--text-secondary)' }}></i>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: '17px' }}>{ca.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: '15px' }}>{ca.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Search */}
        <button className="deel-icon-btn" onClick={onSearch} aria-label="Search (⌘K)" title="Search (⌘K)">
          <i className="bi bi-search" style={{ fontSize: 15 }}></i>
        </button>

        {/* Notifications */}
        <div ref={notifRef} style={{ position: 'relative' }}>
          <button className="deel-icon-btn" onClick={() => setShowNotifs(p => !p)}
            aria-label="Notifications" title="Notifications" style={{ position: 'relative' }}>
            <i className="bi bi-bell" style={{ fontSize: 16 }}></i>
            {notifCount > 0 && (
              <span className="deel-notif-badge">{notifCount > 99 ? '99+' : notifCount}</span>
            )}
          </button>
          {showNotifs && (
            <div style={{ ...dropdown, right: 0, borderRadius: 16, width: 380, maxHeight: 440, overflowY: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 14px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>Notifications</span>
                {notifCount > 0 && (
                  <button onClick={markAllRead} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 13, fontWeight: 500, cursor: 'pointer', padding: 0 }}>Mark all read</button>
                )}
              </div>
              {notifs && notifs.length > 0 ? notifs.slice(0, 15).map(n => {
                const handleNotifClick = () => {
                  setShowNotifs(false);
                  // App-level handler owns routing for server-persisted notifs
                  // (mentions, etc) — those carry richer link metadata than the
                  // legacy in-memory popups can express.
                  if (typeof onNotifClick === 'function') {
                    onNotifClick(n);
                    return;
                  }
                  markAllRead?.();
                  const navType = n.navType || n.type;
                  if (navType === 'task' || navType === 'new_task' || navType === 'sla') { if (n.taskId && setSelTask && tasks) { const t = tasks.find(tk => tk.id === n.taskId); if (t) setSelTask(t); } setView('my-queue'); }
                  else if (navType === 'escalation') { setView('escalations'); }
                  else { setView('briefing'); }
                };
                return (
                <div key={n.id} onClick={handleNotifClick}
                  onMouseEnter={e => e.currentTarget.style.background = n.read ? 'var(--surface-2)' : 'var(--surface-3)'}
                  onMouseLeave={e => e.currentTarget.style.background = n.read ? 'var(--surface)' : 'var(--surface-2)'}
                  style={{ display: 'flex', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--border-light)', background: n.read ? 'var(--surface)' : 'var(--surface-2)', cursor: 'pointer', transition: 'background .15s', alignItems: 'flex-start' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 6, background: n.read ? 'transparent' : n.type === 'escalation' ? 'var(--red-solid)' : n.type === 'success' ? 'var(--success)' : 'var(--accent)' }}></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: n.read ? 400 : 600, color: 'var(--text)', lineHeight: '18px' }}>{n.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{n.body}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{n.time}</div>
                  </div>
                </div>
              );}) : (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                  <i className="bi bi-bell-slash" style={{ fontSize: 28, display: 'block', marginBottom: 8, color: 'var(--text-disabled)' }}></i>
                  No notifications yet
                </div>
              )}
            </div>
          )}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 28, background: 'rgba(0,0,0,0.08)', margin: '0 4px' }}></div>

        {/* User avatar + name + org (Figma style) */}
        <div ref={userRef} style={{ position: 'relative' }}>
          <div onClick={() => setShowUser(p => !p)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '4px 8px 4px 4px', borderRadius: 'var(--radius-pill)', transition: 'background .15s' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.04)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%', background: 'var(--purple-accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontSize: 13, fontWeight: 700, flexShrink: 0,
            }}>{user?.initials || 'U'}</div>
            <div className="deel-user-pill-text" style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: '16px', whiteSpace: 'nowrap' }}>{user?.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: '14px', whiteSpace: 'nowrap' }}>{perms?.accessTypeName || 'Agent'} | {user?.team || 'Ops'}</div>
            </div>
            <i className="bi bi-chevron-down deel-user-pill-chevron" style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 2 }}></i>
          </div>
          {showUser && (
            <div style={{ ...dropdown, right: 0, borderRadius: 14, width: 280, overflow: 'hidden', padding: 0 }}>
              <div style={{ padding: '16px 16px 14px', borderBottom: '1px solid var(--border-light)', background: 'var(--surface-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'var(--purple-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>{user?.initials || 'U'}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{user?.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</div>
                  </div>
                </div>
              </div>
              <div style={{ padding: '4px 0' }}>
                {/* Settings is admin/regional/team-lead only — Agents don't
                    have access (`canView('settings')` is false for them), so
                    the link previously did nothing on click and just looked
                    broken. Hide it entirely for those users. */}
                {perms?.canView('settings') !== false && (
                  <div role="button" tabIndex={0}
                    onClick={() => { setView('settings'); setShowUser(false); }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--text)', transition: 'background .12s' }}>
                    <i className="bi bi-gear" style={{ fontSize: 14 }} /> Settings
                  </div>
                )}
                <div role="button" tabIndex={0}
                  onClick={toggleDark}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--text)', transition: 'background .12s' }}>
                  <i className={darkMode ? 'bi bi-sun' : 'bi bi-moon'} style={{ fontSize: 14 }} /> {darkMode ? 'Light mode' : 'Dark mode'}
                </div>
                <div style={{ height: 1, background: 'var(--border-light)', margin: '4px 0' }}></div>
                <div role="button" tabIndex={0}
                  onClick={() => { setShowUser(false); if (onLogout) onLogout(); }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowUser(false); if (onLogout) onLogout(); } }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--red-light)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--red-solid)', transition: 'background .12s' }}>
                  <i className="bi bi-box-arrow-left" style={{ fontSize: 14 }} /> Sign Out
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DeelTopNav;
