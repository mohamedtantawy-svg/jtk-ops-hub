// ── HrHubView ───────────────────────────────────────────────────────────────
// 2026-05-02 redesign: matches the Feedback board's information density.
// Hero header (icon + title + subtitle + primary New-request button), a
// segmented scope toggle with inline count badges, four large status
// filter cards in a responsive grid, and a compact filter bar that pairs
// flow-type pill chips with search / refresh / settings.
//
// The previous flat header + tab strip burned ~250 px before the first
// row even rendered. The new layout puts the four status cards right
// under the hero, makes the filter row a single line, and tightens row
// padding — net effect is roughly twice the rows visible above the fold
// at 1440 px while the surface still looks polished.
//
// Detail drawer + Settings panel integrations are unchanged. The HR Hub
// composer continues to open via the global `+` button picker (see
// CreateHrHubRequestModal). Comments + Slack-style mention/emoji land in
// HrHubDetailPanel (Stage 4).

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  listHrHubRequests,
  getHrHubRequest,
  getHrHubRequestCounts,
} from '../../services/hrHubApi';
import { approveHideTask } from '../../services/hideTaskApi';
import HrHubDetailPanel from '../hr-hub/HrHubDetailPanel';
import HrHubSettingsPanel from '../hr-hub/HrHubSettingsPanel';
import DenyHideTaskModal from '../modals/DenyHideTaskModal';
import ApproveSlaExtensionModal from '../modals/ApproveSlaExtensionModal';
import DenySlaExtensionModal from '../modals/DenySlaExtensionModal';
import { TASK_SOURCE_DISPLAY } from '../../utils/applySlaExtensions';
import { PermissionsContext, IntegrationsContext } from '../../App';
import { useCurrentDept } from '../../hooks/useCurrentDept';
import { getHubBrand } from '../../lib/hub-brand';
import { MEMBERS, MEMBERS_BY_EMAIL } from '../../data/members';

// Single source of truth for status visuals — same shape as Feedback's
// STATUS_FILTERS so the four buttons feel identical across the two tabs.
const STATUS_FILTERS = [
  { value: 'new',               label: 'New',               icon: 'bi-circle-fill',          color: '#0369a1', bg: '#e0f2fe', tint: '#bae6fd' },
  { value: 'in_progress',       label: 'In Progress',       icon: 'bi-arrow-repeat',         color: '#d97706', bg: '#fff8e6', tint: '#fde68a' },
  // Josephine Tuoyo 2026-05-25 — explicit state for "waiting on the
  // requester to come back with info". Distinct from on_hold (we paused)
  // and from in_progress (we are actively working). Non-terminal: still
  // counted as open everywhere. Purple semantic to read distinct from
  // in_progress amber + on_hold grey.
  { value: 'pending_requester', label: 'Pending Requester', icon: 'bi-hourglass-split',      color: '#7c3aed', bg: '#f3eff8', tint: '#e9d5ff' },
  { value: 'on_hold',           label: 'On Hold',           icon: 'bi-pause-circle-fill',    color: '#737373', bg: '#f5f5f4', tint: '#e7e5e4' },
  { value: 'resolved',          label: 'Resolved',          icon: 'bi-check-circle-fill',    color: '#15803d', bg: '#e8f5e9', tint: '#bbf7d0' },
  // Terminal "closed without resolving" (2026-05-12) — Megan reported HR
  // requests sometimes get declined, not resolved. Red literal stays
  // semantic across light/dark themes.
  { value: 'rejected',          label: 'Rejected',          icon: 'bi-x-circle-fill',        color: '#991b1b', bg: '#fee2e2', tint: '#fecaca' },
];
const STATUS_BY_VALUE = Object.fromEntries(STATUS_FILTERS.map(s => [s.value, s]));

// Per-flow visuals mirror the create-modal cards so the surface feels
// consistent — same icon + accent across the picker, the row chip, and
// the flow filter pill.
// 2026-05-21 split: Escalation Zero + Ops Hub Feedback moved out of HR
// Hub to the Feedback board (kind partition). The visual map keeps the
// retired flow IDs so legacy rows still in the DB render their own
// chip / label on the HR Hub list rather than showing as "unknown" —
// but they're hidden from the picker + filters so the team can't open
// new ones here. The list filter dropdown only surfaces the live flows.
const FLOW_VISUALS = {
  hr_request:        { label: 'HR Request',       short: 'Request',     icon: 'bi-send-fill',         color: '#1f74b3', bg: '#e0f2fe' },
  hr_reporting:      { label: 'HR Reporting',     short: 'Reporting',   icon: 'bi-megaphone-fill',    color: '#dc2626', bg: '#fef2f2' },
  // Retired — kept for legacy row rendering only, not picked up by FLOW_FILTERS.
  escalation_zero:   { label: 'Escalation Zero',  short: 'Escalation',  icon: 'bi-stars',             color: '#7c3aed', bg: '#f3eff8' },
  feedback:          { label: 'Ops Hub Feedback', short: 'Feedback',    icon: 'bi-lightbulb-fill',    color: '#d97706', bg: '#fff8e6' },
  hide_task_request: { label: 'Hide Task',        short: 'Hide Task',   icon: 'bi-eye-slash-fill',    color: '#d42d35', bg: '#fef2f2' },
  sla_extension_request: { label: 'SLA Extension', short: 'SLA Ext',     icon: 'bi-clock-history',     color: '#d97706', bg: '#fff7ed' },
};
const FLOW_FILTERS = [
  { value: 'all',                    label: 'All flows',   icon: 'bi-grid-fill',         color: 'var(--text)' },
  { value: 'hr_request',             label: 'Requests',    icon: 'bi-send-fill',          color: '#1f74b3' },
  { value: 'hr_reporting',           label: 'Reporting',   icon: 'bi-megaphone-fill',     color: '#dc2626' },
  { value: 'hide_task_request',      label: 'Hide Task',   icon: 'bi-eye-slash-fill',     color: '#d42d35' },
  { value: 'sla_extension_request',  label: 'SLA Extension', icon: 'bi-clock-history',   color: '#d97706' },
];

const PRIORITY_DOT = {
  low:      '#9b928a',
  medium:   '#0ea5e9',
  high:     '#f59e0b',
  critical: '#dc2626',
};

const SORTS = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'new',     label: 'Newest' },
  { value: 'oldest',  label: 'Oldest' },
];

function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  const days = Math.floor(mins / 1440);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isManagerRole(user, perms) {
  if (!user) return false;
  // Canonical: read perms.dataScope when available — the resolved access
  // type after roleToAt mapping. Avoids substring traps where labels like
  // "Manager" or "Senior Director" don't include "lead"/"regional"/"admin"
  // (audit 2026-05-04: managers were missing the Team Requests toggle
  // because their access label slipped through the substring check).
  const scope = perms?.dataScope;
  if (scope === 'all_tasks' || scope === 'regional_tasks' || scope === 'team_tasks') return true;
  if (user.role === 'admin') return true;
  // Fallback substring scan — lighter than pulling the access map but
  // less reliable than perms.dataScope. Only fires when perms isn't
  // hydrated yet (very early renders).
  const access = user.access || user.accessTypeName || '';
  if (typeof access === 'string') {
    const lc = access.toLowerCase();
    if (lc.includes('admin') || lc.includes('lead') || lc.includes('manager')) return true;
  }
  return false;
}

export default function HrHubView({ user, onCreateHrHub }) {
  const perms = useContext(PermissionsContext);
  const integrations = useContext(IntegrationsContext);
  // 2026-05-22 — dept-branded hub. Immigration users see "GIX Hub" in the
  // hero + flow chips; Benefits users see "Benefits Hub"; HR Experience
  // keeps "HR Hub". See src/lib/hub-brand.js.
  const deptState = useCurrentDept();
  const hubBrand = useMemo(() => getHubBrand(deptState.dept), [deptState.dept]);
  // Brand-aware copy of FLOW_VISUALS — overrides the long-form label for
  // the two live HR-ops flows so row tooltips + empty-state strings carry
  // the dept's short name. The retired entries (escalation_zero, feedback)
  // stay unchanged because they were renamed before the multi-tenant work.
  const flowVisuals = useMemo(() => ({
    ...FLOW_VISUALS,
    hr_request:   { ...FLOW_VISUALS.hr_request,   label: hubBrand.requestLabel },
    hr_reporting: { ...FLOW_VISUALS.hr_reporting, label: hubBrand.reportingLabel },
  }), [hubBrand]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [denyModalReq, setDenyModalReq] = useState(null);
  // SLA Extension review modals — separate state so the approve flow can
  // carry the manager-chosen day count and the deny flow can carry a
  // reason. Both reset on close + reload the list so the row flips to
  // resolved.
  const [slaApproveModalReq, setSlaApproveModalReq] = useState(null);
  const [slaDenyModalReq, setSlaDenyModalReq] = useState(null);
  const [decisionError, setDecisionError] = useState(null);
  const initialReqId = (() => {
    try {
      const url = typeof window !== 'undefined' ? new URL(window.location.href) : null;
      return url?.searchParams.get('req') || null;
    } catch { return null; }
  })();

  // ── Filters & toggles ─────────────────────────────────────────────────────
  const isManager = isManagerRole(user, perms);
  // Admin gate — required to self-approve on the approval flows (TL / RM
  // are blocked from approving their own row to preserve 4-eyes). Mirrors
  // the inline check on the RequestRow at line below; lifted so the
  // detail panel can read the same value.
  const isAdmin = isManager && (user?.role === 'admin' || (user?.access || '').toLowerCase().includes('admin'));
  // Default scope: managers (TL / RM / Admin / RM-on-call) land on "All
  // Requests" because their primary triage need is the whole queue, not
  // their personal submissions. Agents stay on "My Requests" so the
  // landing page is their own pending work. Melissa Capicchiano 2026-05-20
  // bug "MOC needs to see all requests instead of own requests/my
  // requests": MOC is filled by a manager-level user, and the previous
  // global `'mine'` default forced them to click into "All" on every
  // visit. Note: `isManager` is captured at mount; the deep-link handler
  // below (line ~365 `if (typeof d.scope === 'string') setScope(d.scope)`)
  // still wins for tile-driven navigation.
  const [scope, setScope] = useState(() => (isManager ? 'all' : 'mine'));
  const [flowFilter, setFlowFilter] = useState('all');
  // Josephine Tuoyo 2026-05-26 — assignee picker for All / Team / Mentioned.
  // null = "All assignees" (no extra filter), 'unassigned' = rows with no
  // assignee, or a lowercased email for an exact match. Server applies the
  // predicate on both list + counts so the status cards stay accurate.
  const [assigneeFilter, setAssigneeFilter] = useState(null);
  // Scopes where the picker is meaningful — `mine` rows are mine-as-creator
  // (assignee is independent and useful to filter) but the 2026-05-26 spec
  // confined the picker to scopes where a manager triages others' work.
  // `assigned` is excluded because the scope IS the filter (always self).
  const ASSIGNEE_PICKER_SCOPES = useMemo(() => new Set(['all', 'team', 'mentioned']), []);
  const assigneePickerVisible = ASSIGNEE_PICKER_SCOPES.has(scope);
  // Auto-clear the picker the moment the user leaves a supported scope so
  // the value can't strand and silently filter the next view's data.
  useEffect(() => {
    if (!assigneePickerVisible && assigneeFilter !== null) setAssigneeFilter(null);
  }, [assigneePickerVisible, assigneeFilter]);
  // Also clear when the super-admin switches dept — the previous dept's
  // assignee email won't exist in the new dept's roster, so leaving it
  // selected would silently filter the whole new view to zero rows. Effect
  // is a no-op when filter is already null, so omitting it from deps is
  // safe (the only meaningful trigger here is dept change).
  useEffect(() => {
    setAssigneeFilter(null);
  }, [deptState.deptId]);
  // Dept-scoped member list for the picker. Members carry `orgNodeId` that
  // points at their team/sub-team node; `currentDeptNodeIds` is the Set
  // of every node under the current top-level dept (root + descendants).
  // Empty Set = cold paint, fall back to all members so the picker is
  // never blank during boot.
  const deptMembers = useMemo(() => {
    const nodeIds = deptState.currentDeptNodeIds;
    const pool = (nodeIds && nodeIds.size > 0)
      ? MEMBERS.filter(m => m.orgNodeId && nodeIds.has(m.orgNodeId))
      : MEMBERS;
    return [...pool]
      .filter(m => m && m.email && m.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [deptState.currentDeptNodeIds]);
  // Selected-assignee label for the picker button.
  const assigneeLabel = useMemo(() => {
    if (!assigneeFilter) return 'All assignees';
    if (assigneeFilter === 'unassigned') return 'Unassigned';
    return MEMBERS_BY_EMAIL[assigneeFilter]?.name || assigneeFilter;
  }, [assigneeFilter]);
  // Default to 'new' so the landing page shows actionable work, not
  // historical resolved tasks. Olga Pastuszak 2026-05-14 feedback:
  // "HR HUB - Potentially defaults to Resolved" — with statusFilter=null
  // (all statuses) + sort=updated, she saw recently-resolved tasks first
  // because her new/in-progress queues are empty. Defaulting to 'new'
  // means an empty queue lands on the celebratory empty state below
  // ("You're all caught up!") instead of an old resolved-tasks list.
  // Click "All" anytime to switch — the filter is just a default, not a
  // lock.
  const [statusFilter, setStatusFilter] = useState('new');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState('updated');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  // ── Data ─────────────────────────────────────────────────────────────────
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(null);

  const reqSeqRef = useRef(0);
  const flowQuery = flowFilter === 'all' ? null : flowFilter;

  const loadFirstPage = useCallback(async () => {
    const seq = ++reqSeqRef.current;
    setLoading(true);
    setError(null);
    // Retry-once-on-5xx — the 2026-05-03 live audit (F12) caught HR Hub
    // wedging on "Loading…" with a transient 503 from the deploy pod-warm
    // tail-end (skill §6.6). One immediate retry gives the upstream pod
    // ~600ms to recover before we surface the error and clear cached items.
    const tryFetch = async () => listHrHubRequests({
      flow: flowQuery,
      scope,
      status: statusFilter || undefined,
      search: debouncedSearch || undefined,
      assignee: assigneeFilter || undefined,
      limit: 25,
    });
    try {
      let res;
      try {
        res = await tryFetch();
      } catch (err) {
        const msg = String(err?.message || '');
        const transient = /\b(5\d\d|timeout|abort|network)\b/i.test(msg);
        if (!transient) throw err;
        await new Promise(r => setTimeout(r, 600));
        if (seq !== reqSeqRef.current) return;
        res = await tryFetch();
      }
      if (seq !== reqSeqRef.current) return;
      // 2026-05-21 split: Escalation Zero + Ops Hub Feedback moved to the
      // Feedback board. Legacy rows still exist in hr_hub_requests but
      // we filter them out of the HR Hub list so the team doesn't have
      // a second surface for the same workflow. The rows are still in
      // the DB (no destructive change) — if needed for archaeology, they
      // can be queried directly.
      const filtered = (res?.items || []).filter(it => it.flow !== 'escalation_zero' && it.flow !== 'feedback');
      setItems(filtered);
      setCursor(res?.nextCursor || null);
      setLastSyncAt(Date.now());
    } catch (err) {
      if (seq !== reqSeqRef.current) return;
      setError(err?.message || 'Could not load requests');
      setItems([]);
      setCursor(null);
    } finally {
      if (seq === reqSeqRef.current) setLoading(false);
    }
  }, [flowQuery, scope, statusFilter, debouncedSearch, assigneeFilter]);

  useEffect(() => { loadFirstPage(); }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await listHrHubRequests({
        flow: flowQuery,
        scope,
        status: statusFilter || undefined,
        search: debouncedSearch || undefined,
        assignee: assigneeFilter || undefined,
        cursor,
        limit: 25,
      });
      // Apply the same legacy-flow filter on pagination so escalation_zero /
      // feedback rows never surface in the HR Hub list.
      const filtered = (res?.items || []).filter(it => it.flow !== 'escalation_zero' && it.flow !== 'feedback');
      setItems(prev => [...prev, ...filtered]);
      setCursor(res?.nextCursor || null);
    } catch (err) {
      setError(err?.message || 'Could not load more');
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, flowQuery, scope, statusFilter, debouncedSearch, assigneeFilter, loadingMore]);

  // ── Counts for status cards + scope toggle ─────────────────────────────
  // Single round-trip to /hr-hub/requests/counts. The server runs real
  // SQL COUNT(*) queries scoped to the caller's dept (+ current scope/
  // flow/search), so the badges reflect actual totals — not the
  // truncated 100-row list this used to count from. Mohamed Tantawy
  // 2026-05-22 caught the truncation on HR Experience (Resolved 89 +
  // New 11 = exactly 100, masking the real cumulative resolved figure).
  //
  // byStatus follows the current scope (so the 5 status cards reflect
  // what's in scope today). byScope is pending-only (excludes resolved
  // + rejected) per the 2026-05-04 spec — each scope pill is its own
  // scope so the badges show "things still pending action".
  const [statusCounts, setStatusCounts] = useState({ new: 0, in_progress: 0, on_hold: 0, resolved: 0, rejected: 0, total: 0 });
  const [scopeCounts, setScopeCounts] = useState({ mine: null, assigned: null, team: null, all: null, mentioned: null });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await getHrHubRequestCounts({
          flow: flowQuery,
          scope,
          search: debouncedSearch || undefined,
          assignee: assigneeFilter || undefined,
        });
        if (cancelled) return;
        if (r?.byStatus) setStatusCounts(r.byStatus);
        if (r?.byScope) setScopeCounts(r.byScope);
      } catch { /* swallow */ }
    })();
    return () => { cancelled = true; };
  }, [flowQuery, scope, debouncedSearch, assigneeFilter]);

  // Local sort — server returns newest-first by default; we re-sort client-side
  // for the small page (25 rows) so toggling sort doesn't refetch.
  const sortedItems = useMemo(() => {
    const list = [...items];
    if (sort === 'updated') list.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    else if (sort === 'new') list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    else if (sort === 'oldest') list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return list;
  }, [items, sort]);

  // ── Detail drawer state ──────────────────────────────────────────────────
  const [detailId, setDetailId] = useState(initialReqId);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState(null);

  const loadDetail = useCallback(async (id) => {
    if (!id) { setDetail(null); return; }
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await getHrHubRequest(id);
      setDetail(res);
    } catch (err) {
      setDetailError(err?.message || 'Could not load request');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDetail(detailId);
    try {
      const url = new URL(window.location.href);
      if (detailId) url.searchParams.set('req', detailId);
      else url.searchParams.delete('req');
      window.history.replaceState({}, '', url.toString());
    } catch {}
  }, [detailId, loadDetail]);

  // Bell deep-link handler. App.jsx fires `hr-hub:openDetail` with the
  // request id when the user clicks a notification linked here. Without
  // this listener, clicking a notification while already on the HR Hub
  // tab is a no-op (setView('hr-hub') doesn't re-mount the view, so the
  // ?req= URL change isn't picked up). Mirrors the FeedbackView /
  // LeaderAlertsView / AnnouncementsView pattern.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e) => {
      const id = e?.detail?.id;
      if (!id) return;
      setDetailId(String(id));
    };
    window.addEventListener('hr-hub:openDetail', handler);
    return () => window.removeEventListener('hr-hub:openDetail', handler);
  }, []);

  // Briefing DecisionsStrip tiles dispatch `hr-hub:setFilters` to pre-set
  // scope / flow / status when they land here so the user sees the exact
  // list the tile summarized (e.g. the HR Hub tile lands on scope=team,
  // status=null; the SLA+Hide tile lands on scope=team flow=hide_task).
  // detail keys default to "leave unchanged" when undefined.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e) => {
      const d = e?.detail || {};
      if (typeof d.scope === 'string') setScope(d.scope);
      if (typeof d.flow === 'string') setFlowFilter(d.flow);
      if ('status' in d) setStatusFilter(d.status); // null is explicit "show all"
    };
    window.addEventListener('hr-hub:setFilters', handler);
    return () => window.removeEventListener('hr-hub:setFilters', handler);
  }, []);

  const refreshDetail = useCallback(() => {
    if (detailId) loadDetail(detailId);
  }, [detailId, loadDetail]);

  const onItemUpdated = useCallback((updated) => {
    if (!updated) return;
    setItems(prev => prev.map(it => it.id === updated.id ? { ...it, ...updated } : it));
  }, []);

  // Approve/Deny dispatch for the two row-anchored approval flows. Lifted
  // out of the inline RequestRow JSX so the detail panel can share the
  // exact same workflow — Mohamed 2026-05-19: "SLA extension, when the
  // task is open, you need to add approval or Denial similar to what you
  // see on the table. Right now if you change the status from here, it
  // doesn't impact anything and it goes to solved queue whether you
  // approved or deny." Status-picker PATCH only bumps the status; it
  // doesn't insert the sla_extension row or hidden_task row that the
  // workflow actually needs.
  const handleTaskApprove = useCallback(async (it) => {
    setDecisionError(null);
    // SLA Extension routes through its own modal so the manager can pick
    // 1-7 days. Hide Task is a single-click approve (no extra fields).
    if (it.flow === 'sla_extension_request') {
      setSlaApproveModalReq(it);
      return;
    }
    try {
      await approveHideTask(it.id);
      try { integrations?.hiddenTasks?.refresh?.(); } catch {}
      loadFirstPage();
      refreshDetail();
    } catch (err) {
      setDecisionError(err?.message || 'Approval failed');
    }
  }, [integrations, loadFirstPage, refreshDetail]);

  const handleTaskDeny = useCallback((it) => {
    if (it.flow === 'sla_extension_request') setSlaDenyModalReq(it);
    else setDenyModalReq(it);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={page}>
      <style>{`
        /* 6 status cards (new/in_progress/pending_requester/on_hold/resolved/
           rejected) since 2026-05-25. Wider screens fit all six on one row;
           mid-widths collapse to 3-up (2 rows of 3), narrow to 2-up. */
        .hrhub-status-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
        @media (max-width: 1400px) { .hrhub-status-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        @media (max-width: 900px)  {
          .hrhub-status-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          /* With 6 cards in 2-col, layout is 2+2+2 — no orphan, so the old
             5th-child full-span rule is no longer needed. */
        }
        /* 2026-05-21 audit F49: segments wrap mid-text at narrow viewports
           because the container is inline-flex with no overflow rule.
           Switch to horizontal scroll below 900 px so each segment stays
           legible without forcing the whole rail to wrap. */
        @media (max-width: 900px) {
          .hrhub-scope-row { overflow-x: auto; max-width: 100%; -webkit-overflow-scrolling: touch; scrollbar-width: thin; }
          .hrhub-scope-row > [role="tablist"] { flex-wrap: nowrap; }
          .hrhub-scope-row > [role="tablist"] > button { flex-shrink: 0; }
        }
        .hrhub-row:hover { border-color: var(--border-light); background: var(--surface-2); }
      `}</style>

      {/* Hero header */}
      <div style={pageHead}>
        <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: '#f3eff8', color: '#7c3aed',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <i className="bi-broadcast-pin" style={{ fontSize: 20 }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>{hubBrand.hubLabel}</h1>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {hubBrand.short} Requests, Reporting, Hide Task and SLA Extension flows in one place.
              {lastSyncAt && <> · synced {relTime(new Date(lastSyncAt).toISOString())}</>}
            </div>
          </div>
        </div>
        <button
          onClick={() => onCreateHrHub?.()}
          style={primaryBtn}
        >
          <i className="bi-plus-circle-fill" style={{ fontSize: 13 }} /> New request
        </button>
      </div>

      {/* Scope toggle (My / Team / All / Assigned to me / Mentioned) with count
          badges. "Mentioned" mirrors Slack's @mentions tab — surfaces every
          request where the viewer was tagged in a comment, regardless of who
          created it or whether it's on their team. Visible to all roles. */}
      <div className="hrhub-scope-row" style={scopeRow}>
        <div role="tablist" aria-label="Request scope" style={segmentedControl}>
          {/* Segment order locked 2026-05-20 per Melissa's request: All
              first (manager triage default), then Team, Assigned,
              Mentioned, with My Requests last because the user's own
              submissions are the least-frequent triage target. Same order
              minus Team for non-managers. Default scope is computed at
              mount above (managers → 'all', agents → 'mine'). */}
          {/* 2026-05-21 audit F16: hide "Team Requests" when dataScope is
              `all_tasks` (RM / Director / Admin). For those roles the
              user's "team" equals the dept, so All Requests + Team Requests
              show identical counts and the second segment is dead weight.
              TLs keep the segment because their team is a proper subset of
              All. Agents never had it. */}
          {(isManager
            ? (perms?.dataScope === 'all_tasks'
                ? [{ value: 'all', label: 'All Requests' }, { value: 'assigned', label: 'Assigned to me' }, { value: 'mentioned', label: 'Mentioned', icon: 'bi-at' }, { value: 'mine', label: 'My Requests' }]
                : [{ value: 'all', label: 'All Requests' }, { value: 'team', label: 'Team Requests' }, { value: 'assigned', label: 'Assigned to me' }, { value: 'mentioned', label: 'Mentioned', icon: 'bi-at' }, { value: 'mine', label: 'My Requests' }])
            : [{ value: 'all', label: 'All Requests' }, { value: 'assigned', label: 'Assigned to me' }, { value: 'mentioned', label: 'Mentioned', icon: 'bi-at' }, { value: 'mine', label: 'My Requests' }]
          ).map(seg => {
            const active = scope === seg.value;
            const cnt = scopeCounts[seg.value];
            return (
              <button
                key={seg.value}
                role="tab"
                aria-selected={active}
                onClick={() => setScope(seg.value)}
                style={{ ...segmentBtn, ...(active ? segmentBtnActive : null) }}
              >
                {seg.icon && <i className={seg.icon} style={{ fontSize: 13 }} />}
                {seg.label}
                {cnt != null && (
                  <span style={{ ...segmentCount, ...(active ? segmentCountActive : null) }}>{cnt}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4 large status cards */}
      <div className="hrhub-status-grid" style={{ marginBottom: 12 }}>
        {STATUS_FILTERS.map(f => {
          const active = statusFilter === f.value;
          const cnt = statusCounts[f.value] || 0;
          return (
            <button
              key={f.value}
              onClick={() => setStatusFilter(active ? null : f.value)}
              aria-pressed={active}
              style={{
                ...statusFilterBtn,
                background: active ? f.bg : 'var(--surface)',
                borderColor: active ? f.tint : 'var(--border)',
                boxShadow: active ? `0 0 0 1px ${f.tint} inset, 0 1px 0 rgba(15,23,42,0.02)` : '0 1px 0 rgba(15,23,42,0.02)',
              }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.background = f.bg; e.currentTarget.style.borderColor = f.tint; } }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.borderColor = 'var(--border)'; } }}
            >
              <span style={{
                width: 28, height: 28, borderRadius: 8,
                background: active ? f.color : f.bg,
                color: active ? 'white' : f.color,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                transition: 'background .12s, color .12s',
              }}>
                <i className={f.icon} style={{ fontSize: 13 }} />
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: active ? f.color : 'var(--text)', whiteSpace: 'nowrap' }}>{f.label}</span>
                <span style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--text-muted)' }}>
                  {cnt} {cnt === 1 ? 'request' : 'requests'}
                </span>
              </span>
              <span style={{
                fontSize: 16, fontWeight: 800,
                color: active ? f.color : 'var(--text-muted)',
                fontVariantNumeric: 'tabular-nums',
                marginLeft: 'auto',
              }}>{cnt}</span>
            </button>
          );
        })}
      </div>

      {/* Filter bar — flow chips on the left, search/sort/refresh/settings on the right */}
      <div style={filterBar}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {FLOW_FILTERS.map(f => {
            const active = flowFilter === f.value;
            return (
              <button
                key={f.value}
                onClick={() => setFlowFilter(f.value)}
                style={{
                  ...filterPill,
                  ...(active ? { ...filterPillActive, background: f.value === 'all' ? 'var(--surface-3)' : (FLOW_VISUALS[f.value]?.bg || 'var(--surface-3)'), color: f.color, borderColor: f.color } : null),
                }}
                aria-pressed={active}
                title={f.label}
              >
                <i className={f.icon} style={{ fontSize: 11, color: f.color }} /> {f.label}
              </button>
            );
          })}
          {/* Assignee picker — All / Team / Mentioned only. Lives next to the
              flow chips so the two related "narrow the visible set" controls
              share a row. Sits after the flow chips so it inherits the
              filterBar's flex-wrap behaviour at narrow viewports. */}
          {assigneePickerVisible && (
            <AssigneePicker
              value={assigneeFilter}
              label={assigneeLabel}
              members={deptMembers}
              onChange={setAssigneeFilter}
            />
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexShrink: 0, alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <i className="bi-search" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text-muted)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              style={{ width: 220, height: 32, paddingLeft: 30, paddingRight: 10, borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, background: 'var(--surface)', color: 'var(--text)', outline: 'none' }}
            />
          </div>
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            style={{ height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}
          >
            {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button onClick={() => loadFirstPage()} title="Refresh" style={iconBtn}>
            <i className={loading ? 'bi-arrow-clockwise spin' : 'bi-arrow-clockwise'} style={{ fontSize: 13, color: 'var(--text-muted)' }} />
          </button>
          {perms?.canManageHrHub && (
            <button onClick={() => setSettingsOpen(true)} title={`${hubBrand.hubLabel} Settings`} style={iconBtn}>
              <i className="bi-gear" style={{ fontSize: 13, color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div style={{ marginTop: 4 }}>
        {loading && items.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            Loading…
          </div>
        )}
        {!loading && error && (
          <div style={{ padding: 16, background: '#fef2f2', color: '#991b1b', borderRadius: 10, fontSize: 13 }}>
            {error}
          </div>
        )}
        {!loading && !error && sortedItems.length === 0 && (
          <EmptyState scope={scope} flowFilter={flowFilter} statusFilter={statusFilter} />
        )}
        {decisionError && (
          <div role="alert" style={{ padding: '8px 12px', marginBottom: 8, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: 12 }}>
            <i className="bi-exclamation-triangle-fill" style={{ marginRight: 6 }} />{decisionError}
          </div>
        )}
        {sortedItems.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sortedItems.map(item => (
              <RequestRow
                key={item.id}
                item={item}
                active={detailId === item.id}
                onClick={() => setDetailId(item.id)}
                viewerEmail={user?.email}
                isManager={isManager}
                isAdmin={isAdmin}
                onApprove={handleTaskApprove}
                onDeny={handleTaskDeny}
                flowVisuals={flowVisuals}
              />
            ))}
            {cursor && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                style={{
                  alignSelf: 'center', marginTop: 6,
                  padding: '8px 16px', borderRadius: 10,
                  border: '1px solid var(--border)', background: 'var(--surface)',
                  color: 'var(--text)', fontSize: 13, fontWeight: 500,
                  cursor: loadingMore ? 'wait' : 'pointer',
                }}
              >{loadingMore ? 'Loading more…' : 'Load more'}</button>
            )}
          </div>
        )}
      </div>

      {settingsOpen && <HrHubSettingsPanel onClose={() => setSettingsOpen(false)} />}
      {detailId && (
        <HrHubDetailPanel
          requestId={detailId}
          detail={detail}
          loading={detailLoading}
          error={detailError}
          user={user}
          isManager={isManager}
          isAdmin={isAdmin}
          onApproveTask={handleTaskApprove}
          onDenyTask={handleTaskDeny}
          onClose={() => setDetailId(null)}
          onRefresh={refreshDetail}
          onItemUpdated={onItemUpdated}
        />
      )}
      {denyModalReq && (
        <DenyHideTaskModal
          request={denyModalReq}
          onClose={() => setDenyModalReq(null)}
          onDenied={() => {
            setDenyModalReq(null);
            loadFirstPage();
            refreshDetail();
          }}
        />
      )}
      {slaApproveModalReq && (
        <ApproveSlaExtensionModal
          request={slaApproveModalReq}
          onClose={() => setSlaApproveModalReq(null)}
          onApproved={() => {
            setSlaApproveModalReq(null);
            // Refresh the active-extensions list NOW so the queue's row
            // override picks up the new extension on the very next render,
            // not 30s from now when the next poll would fire. Phase 3 —
            // SLA_EXTENSIONS_PLAN.md sync robustness contract.
            try { integrations?.slaExtensions?.refresh?.(); } catch {}
            loadFirstPage();
            // Refresh the open detail panel too so its status pill +
            // Approved-days field reflect the decision without a manual
            // reload (the panel can be the surface where the manager
            // triggered Approve, not just the list row).
            refreshDetail();
          }}
        />
      )}
      {slaDenyModalReq && (
        <DenySlaExtensionModal
          request={slaDenyModalReq}
          onClose={() => setSlaDenyModalReq(null)}
          onDenied={() => {
            setSlaDenyModalReq(null);
            loadFirstPage();
            refreshDetail();
          }}
        />
      )}
    </div>
  );
}

// Reason-code → short label, used by the hide-task row meta line.
const HIDE_REASON_LABELS = {
  internal_deel_employee: 'Internal Deel Employee',
  test_task: 'Test Task',
  other: 'Other',
};

// ── Row ────────────────────────────────────────────────────────────────────
// Single-line layout matching Feedback's row density: priority dot on
// the far left, flow chip + status pill + meta line in the middle, a
// metadata cluster on the right (attachments / time / chevron).
//
// Hide-task flow rows ALSO render inline Approve/Deny buttons next to the
// status pill — visible only while the request is unresolved. The buttons
// stop propagation so the row click (→ open detail) still works for the
// rest of the row surface.
function RequestRow({ item, active, onClick, viewerEmail, isManager, isAdmin, onApprove, onDeny, flowVisuals = FLOW_VISUALS }) {
  const flow = flowVisuals[item.flow] || flowVisuals.hr_request;
  const status = STATUS_BY_VALUE[item.status] || STATUS_BY_VALUE.new;
  const priColor = PRIORITY_DOT[item.priority] || PRIORITY_DOT.medium;
  const isHide = item.flow === 'hide_task_request';
  const isSlaExt = item.flow === 'sla_extension_request';
  const isDecidable = isHide || isSlaExt;
  const hideMeta = isHide
    ? [HIDE_REASON_LABELS[item.requestType] || item.requestType, item.taskSubject].filter(Boolean).join(' · ')
    : '';
  // SLA extension meta: reason label + days requested + task subject.
  const slaExtReasonLabel = isSlaExt
    ? ({
        immigration: 'Immigration',
        client_unresponsive: 'Client unresponsive',
        employee_unresponsive: 'Employee unresponsive',
      }[item.slaExtReasonCode] || item.slaExtReasonCode)
    : null;
  const slaExtMeta = isSlaExt
    ? [
        slaExtReasonLabel,
        item.slaExtRequestedDays ? `${item.slaExtRequestedDays}d requested` : null,
        item.taskSubject,
      ].filter(Boolean).join(' · ')
    : '';
  const meta = isHide
    ? hideMeta
    : isSlaExt
      ? slaExtMeta
      : [item.functionArea, item.requestType || item.reportType].filter(Boolean).join(' · ');
  // Manager-side decision affordance: visible on every pending hide
  // request to ANY manager (TL / RM / admin). The denormalised
  // `team_lead_email` is the routing target, but live audit 2026-05-04
  // showed the row stuck pending whenever the requester's TL was unset
  // or the routing was wrong, with no fallback path. Broadening the gate
  // to any manager guarantees a human can always action the request.
  //
  // Self-decision rules (2026-05-04 second pass):
  //   • TL / RM: blocked from self-approving — true 4-eyes.
  //   • Admin:  CAN self-approve. Admin requesters typically have no
  //             manager in their chain (managerEmail is empty), so
  //             enforcing 4-eyes on admins meant their hide requests
  //             stuck pending forever with no path to resolution.
  //             The pragmatic exception keeps the workflow movable —
  //             admins are the org's senior trust tier, audit log on
  //             every approve catches misuse.
  // Backend mirrors this rule (see /api/v1/hide-task/[id]/{approve,deny}).
  const viewerLc = (viewerEmail || '').toLowerCase();
  const isSelf = (item.createdByEmail || '').toLowerCase() === viewerLc;
  const canDecide = isDecidable
    && item.status !== 'resolved'
    && item.status !== 'rejected'
    && !!isManager
    && (!isSelf || !!isAdmin);

  return (
    <button
      className="hrhub-row"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px',
        background: active ? 'var(--surface-2)' : 'var(--surface)',
        border: '1px solid ' + (active ? 'var(--border)' : 'var(--border-light)'),
        borderRadius: 10,
        cursor: 'pointer',
        transition: 'background .12s, border-color .12s',
        textAlign: 'left',
        minWidth: 0,
      }}
      title={item.title || item.summary || ''}
    >
      {/* Priority dot (semantic, not a button) */}
      <span style={{
        width: 8, height: 8, borderRadius: 999,
        background: priColor,
        flexShrink: 0,
      }} aria-label={`Priority ${item.priority || 'medium'}`} />

      {/* Flow chip — small icon-only square */}
      <span style={{
        width: 24, height: 24, borderRadius: 6,
        background: flow.bg, color: flow.color,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }} title={flow.label}>
        <i className={flow.icon} style={{ fontSize: 11 }} />
      </span>

      {/* Center: title + meta */}
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, gap: 2 }}>
        <span style={{
          fontSize: 14, fontWeight: 600, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {item.title || (item.summary || '').slice(0, 140) || '(untitled)'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ fontWeight: 600, color: flow.color }}>{flow.short}</span>
          {meta ? ` · ${meta}` : ''}
          {/* Always label the creator so managers can tell at a glance who
              raised the request. When an assignee is set and differs from
              the creator, append it with a routing arrow so creator and
              assignee are unambiguously separated — this row line was the
              dashboard clarity gap Melissa flagged 2026-05-05. */}
          {item.createdByName && (
            <>
              {' · '}
              <span style={{ color: 'var(--text-muted)' }}>From </span>
              <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{item.createdByName}</span>
            </>
          )}
          {item.assigneeName && item.assigneeName !== item.createdByName && (
            <>
              {' '}
              <span style={{ color: 'var(--text-muted)' }}>→</span>{' '}
              <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{item.assigneeName}</span>
            </>
          )}
          {/* 2026-05-22 — OOO cover badge: surfaces that the row was
              auto-routed away from a leave-taking assignee. The
              reconciler flips it back automatically on their return,
              so the badge is informational (not actionable). */}
          {item.coverForAssigneeEmail && (
            <span
              title={`Auto-covered while ${item.coverForAssigneeName || item.coverForAssigneeEmail} is OOO. Will reassign back automatically.`}
              style={{
                marginLeft: 6,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '1px 6px',
                borderRadius: 999,
                background: '#fff7ed',
                color: '#9a3412',
                border: '1px solid #fed7aa',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: 0.2,
                textTransform: 'uppercase',
              }}
            >
              <i className="bi-airplane" style={{ fontSize: 8 }} />
              OOO cover
            </span>
          )}
        </span>
      </span>

      {/* Right: status pill + meta cluster */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {/* Source chip + task link (SLA Extension / Hide Task rows).
            Both flows carry (task_source, task_id, task_url) — making the
            originating queue visible at a glance lets managers triage
            without opening the drawer, and the icon link lets them jump
            straight to the row in Zendesk/Jira/Workbench/etc. */}
        {(isSlaExt || isHide) && item.taskSource && TASK_SOURCE_DISPLAY[item.taskSource] && (() => {
          const meta = TASK_SOURCE_DISPLAY[item.taskSource];
          return (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 9px', borderRadius: 999,
              background: meta.bg, color: meta.color,
              fontSize: 10.5, fontWeight: 700,
            }} title={`Source: ${meta.label}`}>
              <i className={meta.icon} style={{ fontSize: 10 }} />
              {meta.label}
            </span>
          );
        })()}
        {(isSlaExt || isHide) && item.taskUrl && (
          <a
            href={item.taskUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => { e.stopPropagation(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 22, height: 22, borderRadius: 6,
              background: 'transparent', color: 'var(--text-muted)',
              textDecoration: 'none',
              border: '1px solid var(--border-light)',
            }}
            title="Open task in a new tab"
            aria-label="Open task in a new tab"
          >
            <i className="bi-box-arrow-up-right" style={{ fontSize: 11 }} />
          </a>
        )}
        {canDecide && (
          <span
            // Render the two buttons as a plain span (NOT nested button) —
            // wrapping <button> inside a <button>.hrhub-row is invalid HTML
            // and React 19 logs a warning. We split out Approve/Deny as
            // standalone clickables and stop propagation so the row click
            // (→ open detail) still fires for the surrounding surface.
            role="group"
            aria-label="Approve or deny hide request"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onApprove?.(item); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onApprove?.(item); } }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 8,
                background: '#15803d', color: 'white',
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                userSelect: 'none',
              }}
              title="Approve and hide this task globally"
            >
              <i className="bi-check2" style={{ fontSize: 11 }} />Approve
            </span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDeny?.(item); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onDeny?.(item); } }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 8,
                background: 'var(--surface)', color: '#d42d35',
                border: '1px solid #fca5a5',
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                userSelect: 'none',
              }}
              title="Deny — task stays in the queue"
            >
              <i className="bi-x" style={{ fontSize: 11 }} />Deny
            </span>
          </span>
        )}
        {item.mentionedMe && (
          /* Purple "@you" chip — same palette as the mention chips inside
             comment bodies (HrHubDetailPanel:913) so the visual semantics
             "you were tagged here" stays consistent across the surface.
             Sits left of the status pill so the eye lands on the mention
             cue before the workflow state. */
          <span
            title="You were @-mentioned in a comment"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 10.5, fontWeight: 700,
              padding: '3px 8px', borderRadius: 999,
              background: '#f3eff8', color: '#5b21b6',
            }}
          >
            <i className="bi-at" style={{ fontSize: 11 }} />
            you
          </span>
        )}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 11, fontWeight: 700,
          padding: '3px 9px', borderRadius: 999,
          background: status.bg, color: status.color,
        }}>
          <i className={status.icon} style={{ fontSize: 9 }} />
          {status.label}
        </span>
        {item.attachmentCount > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <i className="bi-paperclip" style={{ fontSize: 11 }} /> {item.attachmentCount}
          </span>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 56, textAlign: 'right' }}>
          {relTime(item.updatedAt || item.createdAt)}
        </span>
      </span>
    </button>
  );
}

// ── AssigneePicker ─────────────────────────────────────────────────────────
// Compact dropdown for the filter bar: button shows the current selection
// label, click toggles a popover with a search input + "All assignees" /
// "Unassigned" sentinels + the dept-scoped member list. Outside-click
// closes (skill §3.3). Esc also closes. Selecting an item fires onChange
// with one of: null (clear), 'unassigned', or a lowercased email.
//
// Source of truth for member list = parent (already filtered to the
// caller's current dept via currentDeptNodeIds). This component is
// dept-agnostic; it just renders + filters by the search term.
function AssigneePicker({ value, label, members, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Reset the search each time the popover opens so the previous query
  // doesn't strand on top of a different selection.
  useEffect(() => {
    if (open) {
      setSearch('');
      // Auto-focus the search after the popover mounts so keyboard users
      // can type immediately.
      setTimeout(() => { try { searchRef.current?.focus(); } catch {} }, 0);
    }
  }, [open]);

  const lcSearch = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!lcSearch) return members;
    return members.filter(m =>
      (m.name && m.name.toLowerCase().includes(lcSearch))
      || (m.email && m.email.toLowerCase().includes(lcSearch)),
    );
  }, [lcSearch, members]);

  const isActive = value != null;
  const select = (next) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={isActive ? `Filtered by assignee: ${label}` : 'Filter by assignee'}
        style={{
          ...filterPill,
          ...(isActive
            ? { background: '#f3eff8', color: '#5b21b6', borderColor: '#a78bfa' }
            : null),
        }}
      >
        <i className="bi-person" style={{ fontSize: 11, color: isActive ? '#5b21b6' : 'var(--text-muted)' }} />
        <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isActive ? label : 'Assignee'}
        </span>
        {isActive && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear assignee filter"
            onClick={(e) => { e.stopPropagation(); select(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); select(null); } }}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 14, height: 14, borderRadius: 999,
              background: 'rgba(91,33,182,0.12)', color: '#5b21b6',
              fontSize: 9, cursor: 'pointer', marginLeft: 2,
            }}
          >
            <i className="bi-x" style={{ fontSize: 11 }} />
          </span>
        )}
        {!isActive && <i className="bi-chevron-down" style={{ fontSize: 9, color: 'var(--text-muted)' }} />}
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0,
            minWidth: 240, maxWidth: 320,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, boxShadow: 'var(--shadow-lg)',
            zIndex: 50,
            display: 'flex', flexDirection: 'column',
          }}
        >
          <div style={{ position: 'relative', padding: 8, borderBottom: '1px solid var(--border-light)' }}>
            <i className="bi-search" style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text-muted)' }} />
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search members…"
              style={{
                width: '100%', height: 30, paddingLeft: 26, paddingRight: 8,
                borderRadius: 8, border: '1px solid var(--border)', fontSize: 12,
                background: 'var(--surface)', color: 'var(--text)', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto', padding: 4 }}>
            <PickerOption
              label="All assignees"
              icon="bi-people"
              selected={value == null}
              onSelect={() => select(null)}
            />
            <PickerOption
              label="Unassigned"
              icon="bi-person-dash"
              selected={value === 'unassigned'}
              onSelect={() => select('unassigned')}
            />
            {filtered.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border-light)', margin: '4px 0' }} />
            )}
            {filtered.length === 0 && lcSearch && (
              <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
                No matches
              </div>
            )}
            {filtered.map(m => {
              const email = String(m.email).toLowerCase();
              return (
                <PickerOption
                  key={email}
                  label={m.name}
                  sub={email}
                  selected={value === email}
                  onSelect={() => select(email)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PickerOption({ label, sub, icon, selected, onSelect }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = selected ? 'var(--surface-3)' : 'transparent'; }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', textAlign: 'left',
        padding: '7px 10px', borderRadius: 6,
        border: 'none', background: selected ? 'var(--surface-3)' : 'transparent',
        color: 'var(--text)', fontSize: 12, fontWeight: selected ? 700 : 500,
        cursor: 'pointer', minHeight: 30,
      }}
    >
      {icon && <i className={icon} style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }} />}
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        {sub && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {sub}
          </span>
        )}
      </span>
      {selected && <i className="bi-check2" style={{ fontSize: 13, color: '#7c3aed', flexShrink: 0 }} />}
    </button>
  );
}

function EmptyState({ scope, flowFilter, statusFilter }) {
  let title = 'No requests yet';
  let body = 'Hit the New request button in the header to submit one.';
  let icon = 'bi-inbox';
  let accent = null;          // celebratory accent for the "caught up" case
  // Olga 2026-05-14 — the default landing is `status=new`, so an empty
  // landing is the "caught up" celebration, not a stark "no results".
  // We branch on the common cases first so each gets bespoke copy
  // instead of the generic "No X requests" fallback.
  if (scope === 'mentioned') {
    // Dedicated copy for the Mentions segment — generic "No new requests"
    // would mislead since the segment is cross-status by intent.
    title = 'No mentions yet';
    body = 'When someone tags you with @your.name in a comment, the request will appear here.';
    icon = 'bi-at';
    accent = '#7c3aed';
  } else if (statusFilter === 'new' && scope === 'mine' && flowFilter === 'all') {
    title = "You're all caught up!";
    body = 'No new requests on your plate. Click "All" above to browse the rest.';
    icon = 'bi-emoji-smile';
    accent = '#7c3aed';
  } else if (statusFilter === 'new' && scope === 'mine') {
    title = "You're all caught up!";
    body = `No new ${flowVisuals[flowFilter]?.label || 'requests'} on your plate. Try widening the flow filter.`;
    icon = 'bi-emoji-smile';
    accent = '#7c3aed';
  } else if (statusFilter) {
    const s = STATUS_BY_VALUE[statusFilter];
    title = `No ${s?.label?.toLowerCase() || statusFilter} requests`;
    body = 'Try clearing the status filter or widening the scope.';
  } else if (scope === 'mine') {
    title = 'Nothing on your plate yet';
    body = 'Hit New request in the header to submit one.';
  } else if (flowFilter !== 'all') {
    title = `No ${flowVisuals[flowFilter]?.label || flowFilter} yet`;
    body = 'Switch the flow filter or hit New request to add one.';
  }
  return (
    <div style={{
      padding: '40px 20px', textAlign: 'center',
      border: '1px dashed var(--border)', borderRadius: 12,
      color: 'var(--text-muted)', fontSize: 13,
      background: 'var(--surface)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: 14,
        background: accent ? '#f3eff8' : 'var(--surface-2)',
        color: accent || 'var(--text-muted)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 4,
      }}>
        <i className={icon} style={{ fontSize: 22 }} />
      </div>
      <div style={{ fontSize: 15, color: accent || 'var(--text)', fontWeight: 700 }}>{title}</div>
      <div style={{ maxWidth: 360, lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}

// ── Style tokens (copy of Feedback's so the two surfaces stay in sync) ────
const page = { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, padding: '0 24px 24px', background: 'var(--bg)' };
const pageHead = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '20px 0 12px' };
const scopeRow = { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 };
const segmentedControl = { display: 'inline-flex', padding: 3, borderRadius: 128, background: 'var(--surface-2)', border: '1px solid var(--border-light)', gap: 2 };
const segmentBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 128, border: 'none', background: 'transparent', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all .12s' };
const segmentBtnActive = { background: 'var(--surface)', color: 'var(--text)', boxShadow: '0 1px 3px rgba(15,23,42,0.08)', fontWeight: 700 };
const segmentCount = { padding: '0 7px', borderRadius: 128, fontSize: 10, fontWeight: 700, background: 'rgba(15,23,42,0.06)', color: 'var(--text-muted)', minWidth: 18, textAlign: 'center', lineHeight: '16px' };
const segmentCountActive = { background: '#7c3aed', color: 'white' };
const statusFilterBtn = { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', transition: 'all .15s', textAlign: 'left', minWidth: 0 };
const filterBar = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border-light)', marginBottom: 10, flexWrap: 'wrap' };
const filterPill = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 128, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all .12s' };
const filterPillActive = { background: 'var(--surface-3)', color: 'var(--text)', borderColor: 'var(--text)' };
const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, border: 'none', background: '#7c3aed', color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(124,58,237,0.25)' };
const iconBtn = { width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' };
