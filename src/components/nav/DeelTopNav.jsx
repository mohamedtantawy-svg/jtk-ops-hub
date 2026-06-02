import { useState, useEffect, useRef, useContext } from 'react';
import { PermissionsContext } from '../../App';
import { isApprover } from '../../data/approvers';
import { useCurrentDept } from '../../hooks/useCurrentDept';
import { getHubBrand } from '../../lib/hub-brand';
import Avatar from '../ui/Avatar';
import NotificationPanel from './NotificationPanel';

// Temporary gate: these surfaces are hidden from everyone except the owner
// until the underlying features are production-ready. Remove the
// `restrictToEmail` props below once the app is ready to ship broadly.
const OWNER_EMAIL = 'mohamed.tantawy@deel.com';

/* Primary tabs always visible in the nav bar.
 *
 * Per the 2026-05-03 rebrand:
 *   • Agents:           Home · Workspace · HR Hub · Urgent Assist · Feedback · Announcements
 *   • Managers/Admins:  Home · Workspace · HR Hub · Leaders Hub · Urgent Assist · Feedback · Announcements
 *
 * The Leaders Hub entry is filtered out for non-managerial users via the
 * existing `accessControl.MANAGERIAL_ONLY_VIEWS` set + the tabAllowed()
 * predicate below. Projects / Escalations / Calendar / Knowledge Hub /
 * Analytics / Team primary tabs were deleted in this rebrand. Team still
 * exists as a sub-view inside Leaders Hub. Settings is reachable from the
 * user menu, not the primary nav. */
const PRIMARY_TABS = [
  { id: 'briefing',      icon: 'bi-house',                label: 'Home' },
  { id: 'my-queue',      icon: 'bi-inbox',                label: 'Workspace' },
  // 2026-05-22: label is dept-branded ("HR Hub" / "GIX Hub" / "Benefits Hub" /
  // …) — the static value here is the cold-paint fallback; the runtime label
  // comes from getHubBrand(deptState.dept) inside the render below.
  { id: 'hr-hub',        icon: 'bi-broadcast-pin',        label: 'HR Hub' },
  // OOO & Handovers — single-tab surface (HANDOVERS_PLAN.md). Visible to
  // everyone; visibility is naturally scoped by the reporting tree on
  // both the calendar feed and the handover list. Slotted before
  // Leaders Hub so the visual rhythm (per-user surface → manager
  // surface) reads top-to-bottom for managerial users.
  { id: 'ooo',           icon: 'bi-airplane',             label: 'OOO' },
  // managerialOnly — hard block for agents in addition to MANAGERIAL_ONLY_VIEWS
  // gating in accessControl. Belt-and-braces because Leaders Hub also embeds
  // the Team admin surface; no path through the UI should reach it for an
  // agent (audit 2026-05-04 + spec hardening request).
  { id: 'leader-alerts', icon: 'bi-broadcast',            label: 'Leaders Hub', managerialOnly: true },
  { id: 'urgent-assist', icon: 'bi-exclamation-octagon',  label: 'Urgent Assist' },
  // Org tab (Phase 0, 2026-05-20) — central command for departments / teams
  // / sub-teams / people. Visible to everyone (read-only for agents); edit
  // access gated by `can_manage_org` admin power inside the view itself.
  { id: 'org',           icon: 'bi-diagram-3',            label: 'Org' },
  // NOTE: the Command Center is NOT a global tab — it is a DEPARTMENT with its
  // own app shell (src/components/command-center/CommandCenterApp.jsx), rendered
  // by App.jsx when the effective dept is 'command-center'. Reached via the
  // super-admin dept picker (below) or by being a CC member. (2026-06-03)
  // Tasks (Phase 1, 2026-05-25 → moved 2026-05-25 same-day): originally
  // landed as a top-level primary tab, then relocated under Workspace as
  // a queue source-tab after the first deploy. The Workspace shell owns
  // the tab now (see WORK_TASKS_TAB in Queue.jsx); a deep-link or
  // notification routes here via `setView('my-queue') + dispatch
  // queue:focusSource{ source:'work_tasks' }`. The "New Task" Quick
  // Create action below still works — it just lands on the Workspace
  // Tasks tab with the composer expanded.
  { id: 'feedback',      icon: 'bi-lightbulb',            label: 'Feedback' },
  { id: 'announcements', icon: 'bi-megaphone',            label: 'Announcements' },
];

/* The More dropdown was deleted in the 2026-05-03 rebrand. Calendar,
 * Knowledge Hub and Analytics are gone from the product. The empty
 * MORE_TABS keeps the rendering loops below trivial without conditional
 * removal. */
const MORE_TABS = [];

/* Quick-create actions — opens from the "Quick Create" menu in the top nav.
 * Order per the 2026-05-03 rebrand:
 *   1. HR Hub Request
 *   2. New Leaders Alert (gated to managers via viewReq + managerialOnly)
 *   3. New Urgent Assist
 *   4. Ops Hub Feedback
 *   5. New Announcement
 *
 * The deleted actions (New Task / New Escalation / New Project) are gone.
 * `feedback` action opens HR Hub with the feedback flow preselected — see
 * App.jsx's onCreateFeedback handler.
 *
 * `managerialOnly: true` is a hard block — even if perms.canView returns a
 * truthy value for managerial views (e.g. due to a stale memoised hook
 * snapshot), agents never see the action. Defense-in-depth complement to
 * the existing viewReq check (audit F9). */
// 2026-05-21 split: "Ops Hub Feedback" renamed to "Submit Feedback" and
// rewired to open the 2-card picker (Ops Hub Feedback vs Escalation Zero).
// The HR Hub Request description no longer mentions Escalation Zero or
// Feedback — those moved to the Feedback board.
// 2026-05-22: HR Hub Request `label` + `desc` are dept-branded at render
// time. The static strings here are cold-paint fallbacks only — see the
// brand override applied to `visibleCreate` below.
const CREATE_ACTIONS = [
  // 2026-05-25: New Task at the top of the dropdown — fastest path to
  // capture work for yourself or others. Routes to the Tasks tab with
  // the composer expanded.
  { icon: 'bi-check2-square',     label: 'New Task',          action: 'work-task',     desc: 'Quick todo for you or a teammate' },
  { icon: 'bi-broadcast-pin',     label: 'HR Hub Request',    action: 'hr-hub',        desc: 'HR Request or HR Reporting' },
  { icon: 'bi-broadcast',         label: 'New Leaders Alert', action: 'leader-alerts', desc: 'Quick alert visible to every manager', viewReq: 'leader-alerts', managerialOnly: true },
  { icon: 'bi-exclamation-octagon', label: 'New Urgent Assist', action: 'urgent-assist', desc: 'Log a manual urgent-assist request' },
  // 2026-05-22 — Melissa Capicchiano + Mohamed: dedicated entry for
  // after-hours Case Monitoring requests. Lands on the same Urgent
  // Assist queue but rendered distinctly so the MOC spots monitoring
  // rows at a glance. Eye icon + purple = "watch this".
  { icon: 'bi-eye-fill',           label: 'New Case Monitoring', action: 'case-monitoring', desc: 'Ask the MOC to watch a task after hours' },
  { icon: 'bi-lightbulb',         label: 'Submit Feedback',   action: 'submit-feedback', desc: 'Ops Hub Feedback or Escalation Zero' },
  { icon: 'bi-megaphone',         label: 'New Announcement',  action: 'announcement',  desc: 'Post to the team' },
  { icon: 'bi-tags',               label: 'New Tag Group',     action: 'mention-group', desc: 'Slack-style @-handle that pings a group at once' },
];

const DeelTopNav = ({
  view, setView, user,
  // Real (pre-impersonation) signed-in user — used by the user-menu to
  // decide whether to show "Login as Admin". Driven by the real role, not
  // the impersonated one, so an RM who is currently acting as admin still
  // sees the option (which becomes a no-op via the App.jsx guard) and an
  // agent never sees it regardless of who they impersonate.
  realUser,
  onSearch, notifs, markAllRead, markRead, markUnread, onNotifClick, onViewAllNotifications,
  notifSound,
  onLogout,
  onLoginAsAdmin,
  onCreateAnnouncement, onCreateFeedback, onSubmitFeedback,
  onCreateHrHub,
  onCreateLeaderAlert,
  onCreateUrgentAssist,
  onCreateCaseMonitoring,
  onCreateWorkTask,
  onManageMentionGroups,
  leaderAlertsBadge = 0,
  urgentAssistBadge = 0,
  hrHubBadge = 0,
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
  const [showDeptPicker, setShowDeptPicker] = useState(false);
  const [darkMode,    setDarkMode]    = useState(() => {
    try { return localStorage.getItem('ops_hub_theme') === 'dark'; } catch(e) { return false; }
  });

  // Phase 11a (2026-05-20): super-admin dept picker. The hook auto-fetches
  // /api/v1/dept-scope/current and returns isGlobalSuperAdmin so the chip
  // only renders for mohamed.tantawy@deel.com. Click setDept(id) → POST →
  // page reload so every scoped query refetches against the new boundary.
  const deptState = useCurrentDept();

  const moreRef     = useRef(null);
  const createRef   = useRef(null);
  const notifRef    = useRef(null);
  const userRef     = useRef(null);
  const deptPickerRef = useRef(null);

  // Unified outside-click handler for all dropdowns (fixes QA #149)
  useEffect(() => {
    const h = (e) => {
      if (createRef.current && !createRef.current.contains(e.target)) setShowCreate(false);
      if (moreRef.current && !moreRef.current.contains(e.target)) setShowMore(false);
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifs(false);
      if (userRef.current && !userRef.current.contains(e.target)) setShowUser(false);
      if (deptPickerRef.current && !deptPickerRef.current.contains(e.target)) setShowDeptPicker(false);
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
    if (action === 'announcement') { onCreateAnnouncement?.(); setView('announcements'); }
    // 2026-05-21 split: "Submit Feedback" replaces the old "feedback" entry
    // and opens the picker (Ops Hub Feedback vs Escalation Zero) instead
    // of jumping straight into the Feedback composer. The legacy `feedback`
    // action stays as a fallback so any stale caller still works (lands
    // on the Feedback view with no preselected composer).
    else if (action === 'submit-feedback') { setView('feedback'); onSubmitFeedback?.(); }
    else if (action === 'feedback')   { setView('feedback'); onCreateFeedback?.(); }
    else if (action === 'hr-hub')     { onCreateHrHub?.(); }
    else if (action === 'leader-alerts') { onCreateLeaderAlert?.(); }
    else if (action === 'urgent-assist') { onCreateUrgentAssist?.(); }
    else if (action === 'case-monitoring') { onCreateCaseMonitoring?.(); }
    else if (action === 'mention-group') { onManageMentionGroups?.(); }
    else if (action === 'work-task') { onCreateWorkTask?.(); }
  };

  const unread = notifs ? notifs.filter(n => !n.read).length : 0;
  const notifCount = unread;

  // Filter tabs by user permissions — hide views the user can't access.
  // Role-level fail-safe (audit F9 + 2026-05-04 hardening request):
  // agents must NEVER see Leaders Hub or Team. We treat the access type
  // id as the source of truth — `at_agent` is hard-blocked from any tab
  // or quick-action that's flagged `managerialOnly`. This complements the
  // perms.canView gate so a stale memoised `perms` snapshot or a future
  // permission-table edit can't accidentally unlock the surface.
  const emailLc = (user?.email || '').toLowerCase();
  const accessTypeId = perms?.accessTypeId || perms?.raw?.id || '';
  const isAgentTier = accessTypeId === 'at_agent'
    || (perms?.accessTypeName || '').toLowerCase() === 'agent';
  const tabAllowed = (t) => {
    if (t.restrictToEmail) return emailLc === t.restrictToEmail.toLowerCase();
    if (t.approverOnly && !isApprover(user?.email)) return false;
    if (t.managerialOnly && isAgentTier) return false;
    // Strict gate: only allow when canView returns truthy. The previous
    // `!== false` was lax — undefined / null slipped through and surfaced
    // managerial views in stale-perms windows.
    return !perms || perms.canView(t.id) === true;
  };
  // 2026-05-22 — dept-branded "HR Hub" surfaces. Immigration users see
  // "GIX Hub", Benefits users "Benefits Hub", etc. See src/lib/hub-brand.js.
  // Resolved per-render because the super-admin can switch depts without
  // a page reload (useCurrentDept v2).
  const hubBrand = getHubBrand(deptState.dept);

  const visiblePrimary = PRIMARY_TABS
    .filter(tabAllowed)
    .map(t => (t.id === 'hr-hub' ? { ...t, label: hubBrand.hubLabel } : t));
  const visibleMore = MORE_TABS.filter(tabAllowed);
  const visibleCreate = CREATE_ACTIONS
    .filter(ca => {
      if (ca.restrictToEmail && emailLc !== ca.restrictToEmail.toLowerCase()) return false;
      if (ca.managerialOnly && isAgentTier) return false;
      if (ca.perm && !perms?.canDo(ca.perm)) return false;
      if (ca.viewReq && !perms?.canView(ca.viewReq)) return false;
      return true;
    })
    .map(ca => (ca.action === 'hr-hub'
      ? { ...ca, label: hubBrand.quickCreateLabel, desc: hubBrand.quickCreateDesc }
      : ca));
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
          // Leaders Hub carries an unack-count badge; Urgent Assist
          // shows a "things assigned to me, still open" red number
          // (audit 2026-05-04 follow-up — counts items in My Requests
          // scope across new / in_progress / on_hold). Approval-queue
          // counts are surfaced inside Announcements instead of here.
          let badge = 0;
          if (tab.id === 'leader-alerts' && leaderAlertsBadge > 0) badge = leaderAlertsBadge;
          if (tab.id === 'urgent-assist' && urgentAssistBadge > 0) badge = urgentAssistBadge;
          if (tab.id === 'hr-hub' && hrHubBadge > 0) badge = hrHubBadge;
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
            <NotificationPanel
              notifs={notifs || []}
              unreadCount={notifCount}
              onClose={() => setShowNotifs(false)}
              markAllRead={markAllRead}
              markRead={markRead}
              markUnread={markUnread}
              onViewAll={onViewAllNotifications}
              soundPref={notifSound}
              onNotifClick={(group) => {
                // The panel passes a *group* (collection of related notifications
                // for the same task). Route via the App-level handler when one is
                // wired — it owns deep-linking. Fall back to the legacy view-flip
                // routing for in-memory rows that don't carry link metadata.
                setShowNotifs(false);
                const head = group?.items?.[0];
                if (typeof onNotifClick === 'function' && head) {
                  onNotifClick(head);
                  return;
                }
                if (!head) return;
                markAllRead?.();
                const navType = head.navType || head.type;
                if (navType === 'task' || navType === 'new_task' || navType === 'sla') {
                  if (head.taskId && setSelTask && tasks) {
                    const t = tasks.find(tk => tk.id === head.taskId);
                    if (t) setSelTask(t);
                  }
                  setView('my-queue');
                } else if (navType === 'escalation') {
                  setView('escalations');
                } else {
                  setView('briefing');
                }
              }}
            />
          )}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 28, background: 'rgba(0,0,0,0.08)', margin: '0 4px' }}></div>

        {/* Phase 11a: Super-admin dept picker. Renders only for the single
            global super-admin. Click the chip → dropdown of all active
            top-level depts → POST sets the cookie → page reload scopes
            every read to the new dept. "Reset to home" clears the cookie
            and falls back to the super-admin's own resolved dept. */}
        {deptState.isGlobalSuperAdmin && (
          <div ref={deptPickerRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setShowDeptPicker(p => !p)}
              aria-label="Switch active department"
              title={`Dept: ${deptState.dept?.name || '—'}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 10px', height: 32,
                background: 'var(--purple-light)',
                color: 'var(--purple)',
                border: '1px solid var(--purple)',
                borderRadius: 'var(--radius-pill)',
                fontSize: 12, fontWeight: 700,
                fontFamily: 'inherit',
                cursor: 'pointer',
                maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              <i className="bi bi-diagram-3-fill" style={{ fontSize: 11 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {/* 2026-05-21 audit U07: was "Viewing: HR Experience" — collided with
                    the Briefing scope pill "Viewing: All" which means data-scope, not
                    department. Renamed this prefix to "Dept:" so the two pills carry
                    visibly distinct semantics. */}
                Dept: {deptState.dept?.name || (deptState.loading ? '…' : 'All')}
              </span>
              <i className="bi bi-chevron-down" style={{ fontSize: 9 }} />
            </button>
            {showDeptPicker && (
              <div style={{
                ...dropdown, right: 0, borderRadius: 12,
                padding: '6px 0', minWidth: 240, overflow: 'hidden',
              }}>
                <div style={{
                  padding: '6px 14px 8px',
                  fontSize: 10, fontWeight: 700,
                  color: 'var(--text-disabled)',
                  letterSpacing: 'var(--ls-caps)',
                  textTransform: 'uppercase',
                }}>Switch department</div>
                {(deptState.depts || []).map(d => {
                  const active = deptState.dept?.id === d.id;
                  return (
                    <div
                      key={d.id} role="button" tabIndex={0}
                      onClick={() => { setShowDeptPicker(false); deptState.setDept(d.id); }}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowDeptPicker(false); deptState.setDept(d.id); } }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                      onMouseLeave={e => e.currentTarget.style.background = active ? 'var(--purple-light)' : 'transparent'}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '9px 14px', cursor: 'pointer',
                        background: active ? 'var(--purple-light)' : 'transparent',
                        transition: 'background .12s',
                      }}
                    >
                      <i className="bi bi-building" style={{ fontSize: 13, color: active ? 'var(--purple)' : 'var(--text-secondary)' }} />
                      <span style={{
                        flex: 1, fontSize: 13, fontWeight: active ? 700 : 500,
                        color: active ? 'var(--purple)' : 'var(--text)',
                      }}>{d.name}</span>
                      {active && <i className="bi bi-check2" style={{ fontSize: 13, color: 'var(--purple)' }} />}
                    </div>
                  );
                })}
                <div style={{ height: 1, background: 'var(--border-light)', margin: '4px 0' }} />
                <div
                  role="button" tabIndex={0}
                  onClick={() => { setShowDeptPicker(false); deptState.setDept(null); }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowDeptPicker(false); deptState.setDept(null); } }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 14px', cursor: 'pointer',
                    fontSize: 12, color: 'var(--text-secondary)',
                    transition: 'background .12s',
                  }}
                >
                  <i className="bi bi-arrow-counterclockwise" style={{ fontSize: 12 }} />
                  Reset to home dept
                </div>
              </div>
            )}
          </div>
        )}

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
                  <div style={{ minWidth: 0, flex: 1 }}>
                    {/* 2026-05-21 audit U40: name overflowed without ellipsis
                        ("Mohamed" was rendering as "Mohaman..." cut off mid-
                        word). Match the email row's truncation rules and
                        surface the full name on hover. */}
                    <div title={user?.name} style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name}</div>
                    <div title={user?.email} style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</div>
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
                {/* Login as Admin — shown to Regional Managers only, gated
                    on the REAL signed-in role (so an RM currently acting
                    as admin doesn't see it doubled up). Click impersonates
                    the canonical admin via App.jsx::handleLoginAsAdmin so
                    the existing impersonation banner + Exit affordance
                    handle the rest of the lifecycle. */}
                {realUser
                  && String(realUser?.access || realUser?.role || '').toLowerCase() === 'regional_manager'
                  && String(user?.access || user?.role || '').toLowerCase() !== 'admin'
                  && onLoginAsAdmin && (
                  <div role="button" tabIndex={0}
                    onClick={() => { onLoginAsAdmin(); setShowUser(false); }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLoginAsAdmin(); setShowUser(false); } }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--purple-light, #f5f0ff)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--purple, #7c3aed)', transition: 'background .12s' }}>
                    <i className="bi bi-shield-lock" style={{ fontSize: 14 }} /> Login as Admin
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
