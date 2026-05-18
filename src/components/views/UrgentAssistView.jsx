// ── UrgentAssistView ──────────────────────────────────────────────────────
// Top-level tab that consolidates "HRX Urgent Assist Request" / "HRX Urgent
// Assist" workbench tasks with manually-created urgent assists from the DB.
//
// Layout mirrors the HR Hub view conventions for consistency:
//   1. Hero header (icon, title, subtitle, primary "New Urgent Assist" CTA).
//   2. Scope segmented toggle: My / Team / All Requests.
//   3. Four status cards (New, In Progress, On Hold, Resolved) — clicking a
//      card filters the table; clicking it again clears.
//   4. Filter bar (search + refresh).
//   5. Table — Subject · Type · Country · Assignee · Created · SLA · Status · Link.
//      SLA pill is 6 BIZ HOURS from createdAt (Sat/Sun excluded), uniform
//      across both workbench-sourced and manually-created rows.
//
// Inline status edits on manual rows hit PATCH /api/v1/urgent-assist/[id];
// workbench rows are read-only on this surface (status mirrors the upstream
// Deel admin task — drive that surface via the row's "Open" deep link).

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { PermissionsContext, IntegrationsContext } from '../../App';
import { useUrgentAssistData } from '../../hooks/useUrgentAssistData';
import { updateUrgentAssist, deleteUrgentAssist, listUrgentAssist } from '../../services/urgentAssistApi';
import { isUrgentAssistTaskType } from '../../lib/urgent-assist-task-types';
import { getDirectReports, getAllReports, getVisibleEmailsForAccess } from '../../data/members';
import { getFlag, getCountryName } from '../../data/constants';
import Avatar from '../ui/Avatar';

const STATUS_FILTERS = [
  { value: 'new',         label: 'New',         icon: 'bi-circle-fill',          color: '#0369a1', bg: '#e0f2fe', tint: '#bae6fd' },
  { value: 'in_progress', label: 'In Progress', icon: 'bi-arrow-repeat',         color: '#d97706', bg: '#fff8e6', tint: '#fde68a' },
  { value: 'on_hold',     label: 'On Hold',     icon: 'bi-pause-circle-fill',    color: '#737373', bg: '#f5f5f4', tint: '#e7e5e4' },
  { value: 'resolved',    label: 'Resolved',    icon: 'bi-check-circle-fill',    color: '#15803d', bg: '#e8f5e9', tint: '#bbf7d0' },
];

const STATUS_OPTIONS = STATUS_FILTERS.map(s => ({ value: s.value, label: s.label }));

function fmtDate(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  if (isNaN(d)) return '--';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

function isManagerRole(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const access = user.access || user.accessTypeName || '';
  if (typeof access === 'string') {
    const lc = access.toLowerCase();
    if (lc.includes('admin') || lc.includes('lead') || lc.includes('manager')) return true;
  }
  return false;
}

function isAdminRole(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const access = user.access || user.accessTypeName || '';
  return typeof access === 'string' && access.toLowerCase().includes('admin');
}

// ── SLA pill — 6 biz-hour spec, mirrors WorkbenchSlaBadge in SourceTable ──
function SlaBadge({ slaRemaining, slaBreachStatus }) {
  if (slaRemaining == null) return <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>;
  const breached = slaBreachStatus === 'SLA_BREACHED' || slaRemaining <= 0;
  const abs = Math.abs(slaRemaining);
  const hrs = Math.floor(abs / 3600);
  const mins = Math.floor((abs % 3600) / 60);
  const label = hrs >= 24
    ? `${Math.floor(hrs / 24)}d ${hrs % 24}h`
    : hrs > 0
      ? `${hrs}h ${mins}m`
      : `${mins}m`;
  const tone = breached
    ? { color: '#d42d35', bg: '#fef2f2' }
    : (hrs < 1)
      ? { color: '#ed8d00', bg: '#fff8e6' }   // < 1h remaining = at risk on a 6h SLA
      : { color: '#29811e', bg: '#e8f5e9' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 128, background: tone.bg, color: tone.color, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>
      <i className="bi-clock" style={{ fontSize: 8 }} />
      {breached ? `${label} over` : label}
    </span>
  );
}

function StatusBadge({ status }) {
  const cfg = STATUS_FILTERS.find(s => s.value === status) || STATUS_FILTERS[0];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 128, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.tint}`, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>
      <i className={cfg.icon} style={{ fontSize: 9 }} />
      {cfg.label}
    </span>
  );
}

function StatusSelect({ value, onChange, disabled }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{
        padding: '3px 8px', borderRadius: 8, border: '1px solid #e8e8e8',
        background: 'var(--surface)', fontSize: 11, color: '#1b1b1b',
        cursor: disabled ? 'not-allowed' : 'pointer', outline: 'none',
      }}
    >
      {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export default function UrgentAssistView({ user, onCreate, managerOnCall, onChangeManagerOnCall, onOpenSchedule }) {
  const perms = useContext(PermissionsContext);
  const isAdmin = isAdminRole(user) || perms?.dataScope === 'all_tasks';
  const isManager = isManagerRole(user) || perms?.dataScope === 'team_tasks' || perms?.dataScope === 'regional_tasks';

  // Role-based default scope (Mohamed 2026-05-07): managers land on
  // "Assigned to my team" so they triage their team's incoming work
  // first; everyone else lands on "Assigned to me" so they see the
  // queue routed to them. The user can still flip via the segmented
  // toggle. The "All: Manager on Call View" stays accessible to every
  // role per the same spec.
  const [scope, setScope] = useState(() => (isManager ? 'team' : 'mine'));

  // Listen for the "open Manager on Call view" custom event fired by
  // the global MOC alert popup in App.jsx — when a fresh MOC clicks
  // "Open Manager on Call View" we land them on the All scope so they
  // can see every active urgent assist across the org.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onOpenAll = () => setScope('all');
    window.addEventListener('ops-hub:urgent-assist-open-all', onOpenAll);
    return () => window.removeEventListener('ops-hub:urgent-assist-open-all', onOpenAll);
  }, []);
  const [statusFilter, setStatusFilter] = useState(null);

  // Briefing DecisionsStrip "Urgent Assist" tile dispatches
  // `urgent-assist:setFilters` so the user lands on scope=team
  // (matching the tile count's scoping). detail keys default to "leave
  // unchanged" when undefined.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (e) => {
      const d = e?.detail || {};
      if (typeof d.scope === 'string') setScope(d.scope);
      if ('status' in d) setStatusFilter(d.status); // null = show all
    };
    window.addEventListener('urgent-assist:setFilters', handler);
    return () => window.removeEventListener('urgent-assist:setFilters', handler);
  }, []);
  const [search, setSearch] = useState('');
  const [actionError, setActionError] = useState(null);

  // Compute the manager's team email set + the viewer's full visible chain
  // once. The hook uses these to scope workbench-sourced rows on the FE.
  // Live audit follow-up (2026-05-04): the previous substring match on
  // `user.access` ("admin" / "regional" / "lead") missed managers whose
  // access label is "Manager" (which roleToAt maps to at_regional_mgr but
  // doesn't contain the substring "regional"). Source the scope from
  // `perms.dataScope` instead — it's the canonical resolved value:
  //   • all_tasks       → admin
  //   • regional_tasks  → manager / regional manager — full subtree
  //   • team_tasks      → team lead — direct reports
  //   • own_tasks_only  → agent — self only
  const lcEmail = (user?.email || '').toLowerCase();
  const dataScope = perms?.dataScope || 'own_tasks_only';
  const teamEmails = useMemo(() => {
    if (!lcEmail) return new Set();
    const out = new Set([lcEmail]);
    if (dataScope === 'all_tasks' || dataScope === 'regional_tasks') {
      for (const e of getAllReports(lcEmail)) out.add(e);
    } else if (dataScope === 'team_tasks') {
      for (const r of getDirectReports(lcEmail)) out.add(r.email);
    }
    return out;
  }, [lcEmail, dataScope]);

  const visibleEmails = useMemo(() => {
    if (!lcEmail) return new Set();
    return getVisibleEmailsForAccess(lcEmail) || new Set([lcEmail]);
  }, [lcEmail]);

  const { items, statusCounts, loading, error, refresh, refreshManual } = useUrgentAssistData({
    scope,
    userEmail: lcEmail,
    isManager,
    isAdmin,
    teamEmails,
    visibleEmails,
  });

  // Per-scope active counts (My / Team / All) — rendered as small pills on
  // each ScopePill. "Active" = status NOT resolved. Manual rows fetched
  // per scope (3 light requests, mirrors HR Hub); workbench rows pulled
  // from already-warm context and partitioned client-side using the same
  // predicates as useUrgentAssistData. Re-runs when teamEmails, isAdmin,
  // visibleEmails, or the workbench data shifts.
  const integrationsCtx = useContext(IntegrationsContext);
  const allWorkbenchTasks = integrationsCtx?.queueUnified?.workbenchData?.tasks || [];
  const [scopeCounts, setScopeCounts] = useState({ mine: null, team: null, all: null });
  useEffect(() => {
    if (!lcEmail) return undefined;
    let cancelled = false;
    const wantTeam = isManager;
    const scopes = wantTeam ? ['mine', 'team', 'all'] : ['mine', 'all'];
    (async () => {
      const next = { mine: 0, team: wantTeam ? 0 : null, all: 0 };
      // 1) Manual rows — one fetch per scope. Backend already filters per
      // scope, so we just count non-resolved.
      for (const sc of scopes) {
        try {
          const r = await listUrgentAssist({ scope: sc, limit: 200 });
          if (cancelled) return;
          const itemsRes = Array.isArray(r?.items) ? r.items : [];
          next[sc] = itemsRes.filter(it => it?.status !== 'resolved').length;
        } catch { /* swallow — leave as 0 */ }
      }
      if (cancelled) return;
      // 2) Workbench rows — counted client-side using the same scope
      // predicates the data hook uses, gated to actionable statuses
      // (TO_DO / IN_PROGRESS / ON_HOLD / ESCALATED → mapped to
      // non-resolved on the tab side).
      const NON_RESOLVED_UPSTREAM = new Set(['TO_DO', 'IN_PROGRESS', 'ON_HOLD', 'ESCALATED']);
      const matched = allWorkbenchTasks.filter(t =>
        isUrgentAssistTaskType(t?.taskType) || isUrgentAssistTaskType(t?.sourceType));
      const team = teamEmails || new Set();
      let mineWb = 0, teamWb = 0;
      for (const t of matched) {
        if (!NON_RESOLVED_UPSTREAM.has(t.status)) continue;
        const ae = (t.assignee?.email || '').toLowerCase();
        // mine: assignee = me
        if (ae && ae === lcEmail) mineWb++;
        // team: assignee in caller's team set (manager-only)
        if (wantTeam && ae && team.has(ae)) teamWb++;
      }

      // 3) All-scope workbench count — fetch from the unscoped global
      // endpoint so non-admin users (RM/TL/Agent) get the true global
      // count instead of their scoped subset (matches the table data
      // returned by useUrgentAssistData when scope === 'all'). Without
      // this the badge would say "0" for users like Duygu Cakalli even
      // when 19 active urgent-assist rows exist org-wide.
      let allWb = 0;
      try {
        const { apiFetch } = await import('../../services/api');
        const globalRes = await apiFetch('/urgent-assist/workbench-global');
        if (cancelled) return;
        const globalItems = Array.isArray(globalRes?.items) ? globalRes.items : [];
        for (const t of globalItems) {
          if (NON_RESOLVED_UPSTREAM.has(t.status)) allWb++;
        }
      } catch { /* swallow — All count falls back to 0 + manual */ }

      if (cancelled) return;
      setScopeCounts({
        mine: next.mine + mineWb,
        team: wantTeam ? (next.team || 0) + teamWb : null,
        all:  next.all + allWb,
      });
    })();
    return () => { cancelled = true; };
  }, [lcEmail, isManager, allWorkbenchTasks, teamEmails]);

  // Apply status + search filters client-side. Status pills come from the
  // hook's pre-scoping count, so the four cards stay accurate when the user
  // narrows search (search is purely a row-level filter).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(row => {
      if (statusFilter && row.status !== statusFilter) return false;
      if (q) {
        const hay = `${row.subject} ${row.requestType} ${row.country} ${row.assigneeName} ${row.createdByName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, statusFilter, search]);

  // ── Inline edit handlers (manual rows only) ──
  const handleStatusChange = useCallback(async (row, newStatus) => {
    if (!row?.isManual) return;
    setActionError(null);
    try {
      await updateUrgentAssist(row.rawId, { status: newStatus });
      refreshManual();
    } catch (err) {
      setActionError(err?.message || 'Failed to update status');
    }
  }, [refreshManual]);

  const handleDelete = useCallback(async (row) => {
    if (!row?.isManual) return;
    if (!confirm(`Delete "${row.subject}"? This cannot be undone.`)) return;
    setActionError(null);
    try {
      await deleteUrgentAssist(row.rawId);
      refreshManual();
    } catch (err) {
      setActionError(err?.message || 'Failed to delete');
    }
  }, [refreshManual]);

  // Keyboard shortcut: hitting "n" anywhere on the page (when not in an
  // input) opens the create modal — same affordance HR Hub provides. Skip
  // when an input/textarea/select has focus so typing doesn't trigger.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      onCreate?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCreate]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fafaf9' }}>
      {/* Hero */}
      <div style={{ padding: '20px 32px 12px', background: 'var(--surface)', borderBottom: '1px solid #e8e8e8' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <i className="bi-exclamation-octagon-fill" style={{ fontSize: 22, color: '#d42d35' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1b1b1b' }}>Urgent Assist</div>
            <div style={{ fontSize: 12, color: '#9e9e9e', marginTop: 2 }}>
              HRX urgent-assist requests from Workbench &amp; manual entries · 6h SLA from creation
            </div>
          </div>
          {onOpenSchedule && (
            <button
              type="button"
              onClick={onOpenSchedule}
              aria-label="Open the HRX Urgent Assist MOC schedule"
              title="Open the HRX Urgent Assist MOC schedule"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 8,
                background: 'var(--surface)', color: 'var(--text)',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                border: '1px solid var(--border)',
                fontFamily: 'inherit',
              }}
            >
              <i className="bi-calendar3" style={{ fontSize: 13 }} />
              MOC Schedule
            </button>
          )}
          {onCreate && (
            <button
              type="button"
              onClick={onCreate}
              aria-label="Create new urgent assist request"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 8,
                background: '#1b1b1b', color: 'white',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                border: 'none',
              }}
            >
              <i className="bi-plus-lg" style={{ fontSize: 13 }} />
              New Urgent Assist
            </button>
          )}
        </div>

        {/* Scope toggle. Renamed 2026-05-07 (Mohamed):
              • "Assigned to me"            — default for non-managers
              • "Assigned to my team"       — manager-only; default for managers
              • "All: Manager on Call View" — visible to everyone
            The "Manager on Call view" name signals to anyone (incl.
            agents) that this is the queue the rotating MOC works from.
            The MOC pill below this row makes it clickable / changeable. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <ScopePill value="mine" current={scope} onChange={setScope} label="Assigned to me" count={scopeCounts.mine ?? undefined} />
          {isManager && (
            <ScopePill value="team" current={scope} onChange={setScope} label="Assigned to my team" count={scopeCounts.team ?? undefined} />
          )}
          <ScopePill value="all"  current={scope} onChange={setScope} label="All: Manager on Call View" count={scopeCounts.all ?? undefined} />
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9e9e9e' }}>
            {loading ? 'Loading…' : `${statusCounts.total} ${statusCounts.total === 1 ? 'request' : 'requests'}`}
          </span>
        </div>

        {/* Manager on Call pill — same shape as the BriefingView hero MOC.
            Anyone can change it (server-side gate was opened up in the
            same PR). When changed, the new MOC gets a popup alert via
            App.jsx's MocAlertModal — see App.jsx for the assignment
            detection logic. */}
        {managerOnCall && (
          <UrgentAssistMocPill
            managerOnCall={managerOnCall}
            onChangeManagerOnCall={onChangeManagerOnCall}
          />
        )}

        {/* Status cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginTop: 12 }}>
          {STATUS_FILTERS.map(s => {
            const active = statusFilter === s.value;
            const count = statusCounts[s.value] || 0;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => setStatusFilter(active ? null : s.value)}
                aria-pressed={active}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', borderRadius: 10,
                  background: active ? s.bg : 'white',
                  border: active ? `1.5px solid ${s.color}` : '1px solid #e8e8e8',
                  cursor: 'pointer', textAlign: 'left',
                  boxShadow: active ? `0 1px 4px ${s.color}22` : 'none',
                  fontFamily: 'inherit',
                }}
              >
                <span style={{ width: 28, height: 28, borderRadius: 8, background: s.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <i className={s.icon} style={{ color: s.color, fontSize: 13 }} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: '#9e9e9e', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>{s.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#1b1b1b', lineHeight: 1 }}>{count}</div>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ padding: '10px 32px', background: 'var(--surface)', borderBottom: '1px solid #f0efed', display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ position: 'relative' }}>
          <i className="bi-search" aria-hidden="true" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#9e9e9e' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search subject, country, assignee…"
            aria-label="Search urgent assist requests"
            style={{ width: 280, height: 32, paddingLeft: 30, paddingRight: 10, borderRadius: 8, border: '1px solid #e8e8e8', fontSize: 12, outline: 'none' }}
          />
        </div>
        <button
          type="button"
          onClick={() => refresh()}
          aria-label="Refresh"
          title="Refresh"
          style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #e8e8e8', background: 'var(--surface)', color: loading ? '#ed8d00' : '#9e9e9e', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <i className={loading ? 'bi-arrow-clockwise spin' : 'bi-arrow-clockwise'} style={{ fontSize: 12 }} />
        </button>
        {(statusFilter || search) && (
          <button
            type="button"
            onClick={() => { setStatusFilter(null); setSearch(''); }}
            style={{ height: 32, padding: '0 10px', borderRadius: 8, border: 'none', background: 'transparent', color: '#9e9e9e', fontSize: 11, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}
          >
            Clear filters
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9e9e9e' }}>
          {filtered.length} shown
        </span>
      </div>

      {error && (
        <div role="alert" style={{ padding: '8px 32px', background: '#fef2f2', borderBottom: '1px solid #fecaca', color: '#991b1b', fontSize: 12 }}>
          <i className="bi-exclamation-triangle-fill" style={{ marginRight: 6 }} />{error}
        </div>
      )}
      {actionError && (
        <div role="alert" style={{ padding: '8px 32px', background: '#fef3c7', borderBottom: '1px solid #fde68a', color: '#92400e', fontSize: 12 }}>
          <i className="bi-exclamation-circle-fill" style={{ marginRight: 6 }} />{actionError}
        </div>
      )}

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 && !loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <i className="bi-shield-check" style={{ fontSize: 40, color: '#c0c0c0', display: 'block', marginBottom: 12 }} />
            <div style={{ fontSize: 15, fontWeight: 600, color: '#1b1b1b', marginBottom: 6 }}>
              {statusFilter || search ? 'No matches' : 'All clear'}
            </div>
            <div style={{ fontSize: 13, color: '#9e9e9e' }}>
              {statusFilter || search ? 'Try adjusting the filters' : 'No urgent assist requests in this scope right now.'}
            </div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f5f4f2', position: 'sticky', top: 0, zIndex: 2 }}>
                <Th label="Subject"  align="left" minWidth={220} />
                <Th label="Type"     width={170} />
                <Th label="Country"  width={110} />
                <Th label="Assignee" width={130} />
                {/* Mohamed 2026-05-11: second assignee column auto-tracking
                    the current Manager on Call. The workbench assignee
                    upstream stays in the column to its left (kept for
                    audit / drill-in); this column shows the on-call CO
                    expected to escalate to or pick up the case if needed.
                    Auto-updates when the MoC rotates because the value
                    flows through the prop chain from App.jsx. */}
                <Th label="Urgent Assist Assignee" width={160} />
                <Th label="Created"  width={120} />
                <Th label="SLA (6h)" width={90} />
                <Th label="Status"   width={150} />
                <Th label="Link"     width={100} />
                <Th label=""         width={70} />
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <UrgentRow
                  key={row.id}
                  row={row}
                  managerOnCall={managerOnCall}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDelete}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Row component ──
function UrgentRow({ row, managerOnCall, onStatusChange, onDelete }) {
  const [hov, setHov] = useState(false);
  const flag = getFlag(row.country);
  const countryLabel = getCountryName(row.country) || row.country || '';
  // Display name for the Urgent Assist Assignee column. Falls back through
  // each piece of the MoC payload — when the app is mid-boot before /me /
  // settings/manager-on-call resolves, the prop can be null, in which case
  // we render an em-dash rather than blowing up the row.
  const mocName = managerOnCall?.name
    || managerOnCall?.email
    || '';

  return (
    <tr
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        borderBottom: '1px solid #f0efed',
        background: hov ? '#faf8ff' : 'white',
        transition: 'background .1s',
      }}
    >
      <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 600, color: '#1b1b1b', maxWidth: 320, paddingLeft: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <i
            className={row.isManual ? 'bi-pencil-square' : 'bi-grid-3x3-gap-fill'}
            title={row.isManual ? 'Manually created' : 'From Workbench'}
            style={{ fontSize: 12, color: row.isManual ? '#7c3aed' : '#0369a1', flexShrink: 0 }}
          />
          <span title={row.subject} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
            {row.subject}
          </span>
        </div>
      </td>
      <td style={{ ...tdStyle, fontSize: 11, color: '#616161' }} title={row.requestType}>
        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 128, background: '#fef2f2', color: '#d42d35', border: '1px solid #fca5a5', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>
          {row.requestType}
        </span>
      </td>
      <td style={{ ...tdStyle, fontSize: 12, whiteSpace: 'nowrap' }} title={countryLabel}>
        {flag && <span style={{ marginRight: 3 }}>{flag}</span>}
        <span style={{ color: '#616161', fontWeight: 500 }}>{row.country || '--'}</span>
      </td>
      <td style={tdStyle} title={row.assigneeName || 'Unassigned'}>
        {row.assigneeName ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
            <Avatar name={row.assigneeName} size="xs" />
            <span style={{ fontSize: 11, color: '#1b1b1b', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 90 }}>
              {row.assigneeName.split(' ')[0]}
            </span>
          </div>
        ) : <span style={{ fontSize: 11, color: '#9e9e9e' }}>Unassigned</span>}
      </td>
      {/* Urgent Assist Assignee — auto-tracks Manager on Call. */}
      <td
        style={tdStyle}
        title={mocName ? `Manager on Call: ${mocName}` : 'Manager on Call not set'}
      >
        {mocName ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
            <Avatar name={mocName} size="xs" />
            <span style={{
              fontSize: 11, color: '#1b1b1b', fontWeight: 500,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              maxWidth: 110,
            }}>
              {mocName.split(' ')[0]}
            </span>
            <span
              aria-hidden="true"
              title="Auto-set from Manager on Call — updates when the rota rotates"
              style={{
                marginLeft: 2,
                display: 'inline-flex', alignItems: 'center',
                fontSize: 9, fontWeight: 700,
                color: '#7c3aed', background: '#f3eff8',
                borderRadius: 4, padding: '1px 4px', lineHeight: 1,
              }}
            >
              MoC
            </span>
          </div>
        ) : (
          <span style={{ fontSize: 11, color: '#9e9e9e' }}>—</span>
        )}
      </td>
      <td style={{ ...tdStyle, fontSize: 11, color: '#616161', whiteSpace: 'nowrap' }} title={row.createdAt ? new Date(row.createdAt).toLocaleString() : ''}>
        <div>{fmtDate(row.createdAt)}</div>
        <div style={{ fontSize: 10, color: '#9e9e9e' }}>{relTime(row.createdAt)}</div>
      </td>
      <td style={tdStyle}>
        <SlaBadge slaRemaining={row.slaRemaining} slaBreachStatus={row.slaBreachStatus} />
      </td>
      <td style={tdStyle}>
        {row.isManual ? (
          <StatusSelect value={row.status} onChange={(v) => onStatusChange(row, v)} />
        ) : (
          <StatusBadge status={row.status} />
        )}
      </td>
      <td style={tdStyle}>
        {row.linkUrl ? (
          <a
            href={row.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6,
              background: hov ? '#e8f0fe' : '#f5f4f2', color: hov ? '#1f74b3' : '#9e9e9e',
              fontSize: 10, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap',
              border: hov ? '1px solid #c8d9f0' : '1px solid transparent',
            }}
          >
            <i className="bi-box-arrow-up-right" style={{ fontSize: 9 }} />Open
          </a>
        ) : <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>}
      </td>
      <td style={tdStyle}>
        {row.isManual && (
          <button
            type="button"
            onClick={() => onDelete(row)}
            aria-label={`Delete "${row.subject}"`}
            title="Delete"
            style={{ background: 'transparent', border: 'none', color: '#9e9e9e', cursor: 'pointer', padding: '4px 6px', borderRadius: 6 }}
            onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = '#d42d35'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9e9e9e'; }}
          >
            <i className="bi-trash" style={{ fontSize: 12 }} />
          </button>
        )}
      </td>
    </tr>
  );
}

function ScopePill({ value, current, onChange, label, count }) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      aria-pressed={active}
      style={{
        height: 32, padding: '0 14px', borderRadius: 8,
        border: active ? '1.5px solid #1b1b1b' : '1px solid #e8e8e8',
        background: active ? '#1b1b1b' : 'white',
        color: active ? 'white' : '#616161',
        fontSize: 12, fontWeight: active ? 600 : 500,
        cursor: 'pointer', whiteSpace: 'nowrap',
        fontFamily: 'inherit',
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}
    >
      {label}
      {typeof count === 'number' && (
        <span
          aria-label={`${count} active`}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minWidth: 18, height: 18, padding: '0 6px', borderRadius: 999,
            fontSize: 10, fontWeight: 700,
            background: active ? 'rgba(255,255,255,0.18)' : '#f5f4f2',
            color: active ? 'white' : '#616161',
          }}
        >{count}</span>
      )}
    </button>
  );
}

function Th({ label, width, minWidth, align }) {
  return (
    <th
      scope="col"
      style={{
        ...thStyle,
        ...(width ? { width } : null),
        ...(minWidth ? { minWidth } : null),
        ...(align ? { textAlign: align } : null),
      }}
    >
      {label}
    </th>
  );
}

const thStyle = { padding: '10px 12px', fontSize: 10, fontWeight: 600, color: '#9e9e9e', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid #e8e8e8' };
const tdStyle = { padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' };

// ── Manager on Call pill (mirrors BriefingView hero) ────────────────
// Surfaces the current MOC inline on the Urgent Assist tab so anyone
// landing on "All: Manager on Call View" knows who's the rotating
// owner. The pencil opens a directory picker; clicking a row in the
// picker fires onChangeManagerOnCall() which round-trips to
// /api/v1/settings/manager-on-call and triggers the global popup
// for the new MOC (see App.jsx::MocAlertModal).
function UrgentAssistMocPill({ managerOnCall, onChangeManagerOnCall }) {
  const [showPicker, setShowPicker] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!showPicker) return undefined;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setShowPicker(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showPicker]);

  // Directory shown in the picker — sourced from the live MEMBERS
  // roster so admin/manager promotions are reflected immediately.
  // Lazy-import to avoid pulling the whole module-graph cost on
  // first render.
  const candidates = useMemo(() => {
    try {
      // eslint-disable-next-line global-require
      const { MEMBERS_BY_EMAIL } = require('../../data/members');
      return Object.values(MEMBERS_BY_EMAIL || {})
        .filter(m => m && !m.isDeleted)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } catch { return []; }
  }, []);

  return (
    <div ref={ref} style={{ marginTop: 10, display: 'inline-flex', position: 'relative' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 12px 5px 5px', borderRadius: 128, background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <Avatar name={managerOnCall.name} initials={managerOnCall.initials} src={managerOnCall.avatarUrl} size={22} />
        <div style={{ fontSize: 12, lineHeight: '16px', whiteSpace: 'nowrap' }}>
          <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Manager On Call:</span>{' '}
          <span style={{ fontWeight: 700, color: 'var(--text)' }}>{managerOnCall.name}</span>
        </div>
        <button
          type="button"
          onClick={() => setShowPicker(p => !p)}
          aria-label="Change manager on call"
          title="Anyone can rotate the manager on call"
          style={{ width: 22, height: 22, padding: 0, border: 'none', background: 'transparent', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .12s' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          <i className="bi bi-pencil" style={{ fontSize: 11, color: 'var(--text-muted)' }} />
        </button>
      </div>
      {showPicker && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', padding: '6px 0', minWidth: 300, maxHeight: 360, overflowY: 'auto', zIndex: 1000 }}>
          <div style={{ padding: '6px 16px 8px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.04em', textTransform: 'uppercase' }}>Select Manager On Call</div>
          {candidates.length === 0 ? (
            <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)' }}>No members available.</div>
          ) : (
            candidates.map(m => {
              const selected = (managerOnCall.email || '').toLowerCase() === (m.email || '').toLowerCase();
              return (
                <div
                  key={m.email}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    onChangeManagerOnCall?.({ name: m.name, initials: m.initials, email: m.email, avatarUrl: m.avatarUrl });
                    setShowPicker(false);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onChangeManagerOnCall?.({ name: m.name, initials: m.initials, email: m.email, avatarUrl: m.avatarUrl });
                      setShowPicker(false);
                    }
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = selected ? 'var(--surface-2)' : 'transparent'; }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', cursor: 'pointer', transition: 'background .12s', background: selected ? 'var(--surface-2)' : 'transparent' }}
                >
                  <Avatar name={m.name} initials={m.initials} src={m.avatarUrl} size={28} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: selected ? 600 : 400, color: selected ? '#7c3aed' : 'var(--text)', lineHeight: '17px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: '15px' }}>{m.team}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
