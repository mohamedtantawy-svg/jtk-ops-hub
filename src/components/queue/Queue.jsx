import { useState, useEffect, useRef, useCallback, useMemo, useContext, memo } from 'react';
import { TOOLS, FUNCTIONS, SLA_MINS, getFlag, getCountryName } from '../../data/constants';
import { useVirtualRows } from '../../hooks/useVirtualRows';

// Same row-height contract as SourceTable — every <QueueRow /> inline-locks
// its <tr> to 44px so the windowing math stays accurate even when Jira's
// 3,000+ rows are in the dataset.
const TICKET_ROW_HEIGHT = 44;
import { MEMBERS_BY_EMAIL } from '../../data/members';
import { slaInfo, getUrl } from '../../utils/helpers';
import {
  scopeOffboardingCases,
  scopeWorkbenchTasks,
  scopeOnboardingPeople,
  scopePausedOnboarding,
  scopeAmendmentRequests,
  scopeRedlineRequests,
  scopeIncentivePlans,
  filterByAssignee as scopeTicketsByAssignee,
  getVisibleEmails,
  isAdminUser,
} from '../../lib/queue-scoping';
import { ToolBadge, StatusBadge, SlaBadge } from '../ui/Badges';
import { PermissionsContext, SettingsContext, IntegrationsContext } from '../../App';
import Avatar from '../ui/Avatar';
import { useQueueSlaSettings } from '../../hooks/useQueueSlaSettings';
import UnifiedSyncButton from './UnifiedSyncButton';
import SourceTable from './SourceTable';
import ErrorBoundary from '../ui/ErrorBoundary';
import {
  normalizeOnboarding,
  normalizeOffboarding,
  normalizeAmendments,
  normalizeRedlines,
  normalizeWorkbench,
  normalizePausedOnboarding,
  normalizeIncentivePlans,
} from '../../utils/normalizeSourceRows';
import { isUrgentAssistTaskType } from '../../lib/urgent-assist-task-types';
import CreateHideTaskRequestModal from '../modals/CreateHideTaskRequestModal';
import ReassignTaskModal from '../modals/ReassignTaskModal';
import CreateHrHubRequestModal from '../modals/CreateHrHubRequestModal';

// ── Live assignee lookup ───────────────────────────────────────────────────
// Reads the live MEMBERS_BY_EMAIL binding so hydrateRoster() updates reach
// the row without recomputing a snapshot. Email is stable across hydrations,
// so we key off `assigneeEmail` and only fall back to the source-provided
// `assigneeName` for external users not in our roster.
function resolveAssignee(task) {
  const email = task?.assigneeEmail ? task.assigneeEmail.toLowerCase() : null;
  const fromRoster = email ? MEMBERS_BY_EMAIL[email] : null;
  if (fromRoster) return fromRoster;
  return { name: task?.assigneeName || 'Unassigned' };
}

// ── Time formatter ──
// Caps long ages at days/weeks/months/years so a stale ticket from 2023
// doesn't render as "24872h ago". Anything older than 1 year just says
// "1y+ ago" — the exact age stops being useful past that point and the
// 2.84-year-old timestamps were uglying up the table.
const relTime = (m) => {
  if (!Number.isFinite(m) || m <= 0) return 'now';
  if (m < 60) return `${m}m ago`;
  if (m < 120) { const r = m % 60; return r ? `1h ${r}m ago` : '1h ago'; }
  if (m < 24 * 60) return `${Math.floor(m / 60)}h ago`;
  const days = Math.floor(m / (24 * 60));
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return '1y+ ago';
};

// ── Work Source Button config ──
const WORK_SOURCES = [
  { id: 'onboarding',     label: 'Onboarding',     icon: 'bi-person-plus-fill',   color: '#7c3aed', bg: '#f3eff8' },
  { id: 'offboarding',    label: 'Offboarding',    icon: 'bi-person-dash-fill',   color: '#d42d35', bg: '#fef2f2' },
  { id: 'amendments',     label: 'Amendments',     icon: 'bi-pencil-square',      color: '#ed8d00', bg: '#fff8e6' },
  { id: 'redlines',       label: 'Redlines',       icon: 'bi-file-earmark-diff',  color: '#7c3aed', bg: '#f3eff8' },
  { id: 'incentive_plans',label: 'Incentive Plans',icon: 'bi-cash-coin',          color: '#0e7490', bg: '#ecfeff' },
  { id: 'workbench',      label: 'Workbench',      icon: 'bi-grid-3x3-gap-fill',  color: '#0369a1', bg: '#eff6ff' },
  { id: 'jira',           label: 'Jira',           icon: 'bi-kanban-fill',        color: '#1f74b3', bg: '#e8f0fe' },
  { id: 'zendesk',        label: 'Zendesk',        icon: 'bi-headset',            color: '#29811e', bg: '#e8f5e9' },
];

const PRIORITY_DOT = { critical: '#dc2626', high: '#d97706', medium: '#0369a1', low: '#9b928a' };

// Load saved filters from localStorage. Key is suffixed with the signed-in
// user's email so two people on the same browser don't inherit each other's
// filter state — a regression caught during the 2026-05-01 Queue review.
const QUEUE_FILTERS_KEY_BASE = 'ops_hub_queue_filters';
const queueFiltersKey = (email) => {
  const lc = (email || '').toLowerCase();
  return lc ? `${QUEUE_FILTERS_KEY_BASE}:${lc}` : QUEUE_FILTERS_KEY_BASE;
};
const loadFilters = (email) => {
  // SSR safety: localStorage is undefined on the server. Reading during render
  // (or initial useState) caused React #418 hydration mismatches because the
  // server initialised every filter to `null`/`[]` while the client populated
  // them from saved state on first paint. Always return null on the server;
  // the post-mount effect re-applies persisted filters after hydration.
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(queueFiltersKey(email))
      || (!email ? localStorage.getItem(QUEUE_FILTERS_KEY_BASE) : null);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const Queue = ({ user, tasks, subFilter }) => {
  // Filters always start in their default state to keep SSR HTML identical
  // to the first client render. The `useEffect` below rehydrates from
  // localStorage after mount — prevents React #418 hydration mismatches
  // that fired on every Queue navigation per the launch audit.
  const [fTool, setFTool] = useState(null);
  const [fStatus, setFStatus] = useState([]);
  const [search, setSearch] = useState('');
  const [fSla, setFSla] = useState(null);
  const [fJiraActionable, setFJiraActionable] = useState(true);
  const [fJiraRaised, setFJiraRaised] = useState(false);
  const [fUnassigned, setFUnassigned] = useState(false);

  // Post-mount filter rehydration — runs once per signed-in identity.
  useEffect(() => {
    const saved = loadFilters(user?.email);
    if (!saved) return;
    if (saved.fTool) setFTool(saved.fTool);
    if (Array.isArray(saved.fStatus)) setFStatus(saved.fStatus);
    else if (saved.fStatus) setFStatus([saved.fStatus]);
    if (saved.fSla) setFSla(saved.fSla);
    if (typeof saved.fJiraActionable === 'boolean') setFJiraActionable(saved.fJiraActionable);
    if (typeof saved.fJiraRaised === 'boolean') setFJiraRaised(saved.fJiraRaised);
    if (saved.fUnassigned) setFUnassigned(true);
  }, [user?.email]);
  const [workSource, setWorkSource] = useState(null);
  // ── Column sort for the ZD/Jira table ─────────────────────────────────────
  // Default = SLA tier (Breached → At-Risk → On Track), oldest-first within
  // each tier. Clicking a column header switches primary sort to that column;
  // the SLA tier+age comparator stays as a tie-break so a "by Country" view
  // still surfaces the most-urgent rows first inside each country bucket.
  const [sortCol, setSortCol] = useState('sla');
  const [sortDir, setSortDir] = useState('asc');
  const toggleSort = useCallback((col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  }, [sortCol]);

  // Scroll container ref for the ZD/Jira table virtualizer (the Deel
  // panels each get their own scroller inside SourceTable).
  const ticketScrollerRef = useRef(null);

  const perms = useContext(PermissionsContext);
  const settings = useContext(SettingsContext);
  const { queueSync, queueUnified, hiddenTasks } = useContext(IntegrationsContext);
  const isHiddenKey = useCallback((source, id) => {
    if (!source || !id) return false;
    const key = `${String(source).toLowerCase()}:${String(id)}`;
    return !!(hiddenTasks?.hiddenKeys?.has(key));
  }, [hiddenTasks?.hiddenKeys]);

  // Hide-task modal state — opened from the Actions column in either the
  // ZD/Jira table or any Source panel. The descriptor carries everything
  // the modal needs (subject + source + id + url) so the modal stays
  // shape-agnostic across the seven row types.
  const [hideModalTask, setHideModalTask] = useState(null);
  // Reassign modal state — only opens for source rows whose upstream
  // doesn't support reassignment (onboarding / amendments / redlines /
  // incentive plans). Same descriptor shape as hide + the row's current
  // assignee so the modal can show "Current" next to that name and offer
  // a "Reset to original" affordance.
  const [reassignModalTask, setReassignModalTask] = useState(null);
  // Bulk variants of the same modals — populated when the user clicks a
  // bulk-bar button on SourceTable. ReassignTaskModal /
  // CreateHideTaskRequestModal both accept a `tasks` array and submit one
  // POST per task; partial failures surface inline rather than aborting
  // the whole batch.
  const [bulkReassignTasks, setBulkReassignTasks] = useState(null);
  const [bulkHideTasks, setBulkHideTasks] = useState(null);
  // Build a uniform task descriptor from a normalized SourceTable row, so
  // the bulk modal sees the same shape the per-row modal has always seen.
  const buildTaskDescriptor = useCallback((row, sourceKey) => ({
    source: sourceKey,
    id: String(row.id),
    url: row.taskUrl || null,
    subject: row.subject,
    country: row.country,
    assigneeEmail: row.assigneeEmail || null,
    assigneeName: row.assignee || null,
    hasOverride: !!row.reassignedFromEmail,
  }), []);
  // Escalate-to-HR-Hub modal state. Same descriptor shape as hide. We
  // resolve the requester's direct manager (managerEmail in the roster)
  // and seed it as the assignee so the new HR Hub request lands on the
  // right person without an extra Triage step. Falls back to the team-
  // lead chain if the user has no direct manager set.
  const [escalateModalTask, setEscalateModalTask] = useState(null);
  const escalatePrefill = useMemo(() => {
    if (!escalateModalTask) return null;
    const me = MEMBERS_BY_EMAIL[(user?.email || '').toLowerCase()] || null;
    const managerEmailRaw = me?.managerEmail || '';
    let assigneeEmail = managerEmailRaw ? String(managerEmailRaw).toLowerCase() : null;
    let assigneeName = null;
    if (assigneeEmail) {
      assigneeName = MEMBERS_BY_EMAIL[assigneeEmail]?.name || null;
    } else {
      // Walk up the chain looking for any TL/RM/admin so the request
      // doesn't land orphaned when the immediate manager is unset.
      let cursor = (user?.email || '').toLowerCase();
      const seen = new Set();
      for (let i = 0; i < 6 && cursor && !seen.has(cursor); i++) {
        seen.add(cursor);
        const m = MEMBERS_BY_EMAIL[cursor];
        if (!m) break;
        const a = (m.access || '').toLowerCase();
        if (i > 0 && (a === 'team_lead' || a === 'regional_manager' || a === 'admin')) {
          assigneeEmail = cursor;
          assigneeName = m.name || null;
          break;
        }
        cursor = (m.managerEmail || '').toLowerCase();
      }
    }
    const subj = escalateModalTask.subject || '';
    return {
      links: escalateModalTask.url ? [escalateModalTask.url] : [],
      title: subj ? `Escalation from queue: ${subj}`.slice(0, 280) : 'Escalation from queue',
      assigneeEmail,
      assigneeName,
      banner: {
        title: 'Escalating from queue',
        subtitle: subj
          ? `${TOOLS[escalateModalTask.source]?.label || escalateModalTask.source}${escalateModalTask.country ? ` · ${escalateModalTask.country}` : ''} · ${subj.slice(0, 120)}`
          : (TOOLS[escalateModalTask.source]?.label || escalateModalTask.source || ''),
        color: '#7c3aed', bg: '#f5f3ff',
        icon: 'bi-arrow-up-right-circle-fill',
      },
    };
  }, [escalateModalTask, user?.email]);

  // Wire subFilter from parent (BriefingView "View resolved" etc.) to internal filter
  useEffect(() => {
    if (subFilter) {
      const statusMap = { Resolved: 'resolved', New: 'new', 'In Progress': 'in_progress', Waiting: 'waiting' };
      const mapped = statusMap[subFilter] || subFilter.toLowerCase();
      setFStatus([mapped]);
    }
  }, [subFilter]);

  // Unified sync aggregator — pre-warmed at the App.jsx boundary so every
  // queue's data is already in flight (or done) by the time the user
  // clicks any tab. We just read it from context here. Fallback to an
  // empty shape so the unsigned-in / SSR path doesn't crash.
  const unified = queueUnified || {};
  const {
    onboardingData = { items: [] },
    pausedOnboardingData = { items: [] },
    offboardingData = { items: [] },
    changeRequestData = { amendments: [], redlines: [] },
    workbenchData = { tasks: [] },
    incentivePlansData = { items: [] },
    meta: syncMeta = {},
    sources: syncSources = {},
    refreshAll: syncRefreshAll = () => {},
    nowTick: syncNowTick = Date.now(),
  } = unified;

  // ── Normalized rows for SourceTable ──
  // Each *RowsAll memo applies the global hide list as a final filter so
  // approved hides drop off every panel + the ZD/Jira table without each
  // call site having to remember to do it. We use the row's `id` against
  // the corresponding `task_source` key the hide flow stores.
  const { sla: queueSla } = useQueueSlaSettings();
  const onboardingRowsAll       = useMemo(() => normalizeOnboarding(onboardingData.items, queueSla).filter(r => !isHiddenKey('onboarding', r.id)), [onboardingData.items, queueSla, isHiddenKey]);
  const pausedOnboardingRowsAll = useMemo(() => normalizePausedOnboarding(pausedOnboardingData.items, queueSla).filter(r => !isHiddenKey('paused_onboarding', r.id) && !isHiddenKey('onboarding', r.id)), [pausedOnboardingData.items, queueSla, isHiddenKey]);
  const offboardingRowsAll      = useMemo(() => normalizeOffboarding(offboardingData.items, queueSla).filter(r => !isHiddenKey('offboarding', r.id)), [offboardingData.items, queueSla, isHiddenKey]);
  const amendmentRowsAll        = useMemo(() => normalizeAmendments(changeRequestData.amendments, queueSla).filter(r => !isHiddenKey('amendments', r.id)), [changeRequestData.amendments, queueSla, isHiddenKey]);
  const redlineRowsAll          = useMemo(() => normalizeRedlines(changeRequestData.redlines, queueSla).filter(r => !isHiddenKey('redlines', r.id)), [changeRequestData.redlines, queueSla, isHiddenKey]);
  // Strip "HRX Urgent Assist Request" / "HRX Urgent Assist" tasks — they
  // surface on the dedicated Urgent Assist tab and would otherwise double-
  // list here. Filter happens BEFORE normalize so the row count + SLA
  // pills + sort order agree with the visible table.
  const workbenchTasksFiltered = useMemo(
    () => (workbenchData.tasks || []).filter(t => !isUrgentAssistTaskType(t?.taskType) && !isUrgentAssistTaskType(t?.sourceType)),
    [workbenchData.tasks],
  );
  const workbenchRowsAll        = useMemo(() => normalizeWorkbench(workbenchTasksFiltered, queueSla).filter(r => !isHiddenKey('workbench', r.id)), [workbenchTasksFiltered, queueSla, isHiddenKey]);
  const incentivePlanRowsAll    = useMemo(() => normalizeIncentivePlans(incentivePlansData.items, queueSla).filter(r => !isHiddenKey('incentive_plans', r.id)), [incentivePlansData.items, queueSla, isHiddenKey]);

  const isAdmin = isAdminUser(user);
  const isLead = perms?.dataScope === 'team_tasks';
  // Reassign is gated to admin/regional_manager/team_lead — agents must
  // route through their TL. Mirrors the role gate enforced server-side at
  // /api/v1/queue/source-reassign so the button never appears for agents
  // (otherwise the click would 403 from middleware).
  const canReassign = perms?.dataScope && perms.dataScope !== 'own_tasks_only';
  const ns = (tasks || []).filter(t => t.source !== 'slack' && t.source !== 'calendar' && !isHiddenKey(t.source, t.id));

  // Emails the current viewer "owns" — their email + every teammate below
  // them in the hierarchy (used to classify each Jira ticket as Actionable
  // vs Raised by You for the filter chips and counts).
  const visibleEmails = useMemo(() => getVisibleEmails(user), [user]);

  const jiraIsActionable = useCallback((t) => {
    if (t?.source !== 'jira') return false;
    if (isAdmin) return true;
    if (t.assigneeEmail && visibleEmails.has(t.assigneeEmail.toLowerCase())) return true;
    if (Array.isArray(t.jiraHrxEmails)) {
      for (const e of t.jiraHrxEmails) {
        if (e && visibleEmails.has(e.toLowerCase())) return true;
      }
    }
    return false;
  }, [visibleEmails, isAdmin]);
  const jiraIsRaised = useCallback((t) => {
    if (t?.source !== 'jira') return false;
    if (!t.jiraReporterEmail) return false;
    if (isAdmin) return true;
    return visibleEmails.has(t.jiraReporterEmail.toLowerCase());
  }, [visibleEmails, isAdmin]);
  const passesJiraRoleFilter = useCallback((t) => {
    if (t?.source !== 'jira') return true;
    const act = fJiraActionable && jiraIsActionable(t);
    const rai = fJiraRaised && jiraIsRaised(t);
    return act || rai;
  }, [fJiraActionable, fJiraRaised, jiraIsActionable, jiraIsRaised]);

  // ── Per-source scoping (see lib/queue-scoping.js for the full matrix) ──
  const onboardingActionRows = useMemo(() => scopeOnboardingPeople(onboardingRowsAll, user), [onboardingRowsAll, user]);
  const pausedOnboardingRows = useMemo(() => scopePausedOnboarding(pausedOnboardingRowsAll, user), [pausedOnboardingRowsAll, user]);
  const onboardingRows = useMemo(() => {
    const seen = new Set();
    const merged = [];
    for (const r of [...onboardingActionRows, ...pausedOnboardingRows]) {
      const k = r?.id != null ? String(r.id) : r;
      if (seen.has(k)) continue;
      seen.add(k); merged.push(r);
    }
    return merged;
  }, [onboardingActionRows, pausedOnboardingRows]);
  const offboardingRows = useMemo(() => scopeOffboardingCases(offboardingRowsAll, user), [offboardingRowsAll, user]);
  const amendmentRows   = useMemo(() => scopeAmendmentRequests(amendmentRowsAll, user), [amendmentRowsAll, user]);
  const redlineRows     = useMemo(() => scopeRedlineRequests(redlineRowsAll, user), [redlineRowsAll, user]);
  const workbenchRows   = useMemo(() => scopeWorkbenchTasks(workbenchRowsAll, user), [workbenchRowsAll, user]);
  const incentivePlanRows = useMemo(() => scopeIncentivePlans(incentivePlanRowsAll, user), [incentivePlanRowsAll, user]);
  const allSourceRows   = useMemo(() => [
    ...onboardingRows, ...offboardingRows, ...amendmentRows, ...redlineRows, ...workbenchRows, ...incentivePlanRows,
  ], [onboardingRows, offboardingRows, amendmentRows, redlineRows, workbenchRows, incentivePlanRows]);

  // ── Memoized filter chain — only recomputes when inputs change ──
  const { baseVis, visPreSla, active, snoozed, done, all } = useMemo(() => {
    let _vis = scopeTicketsByAssignee(ns, user).filter(passesJiraRoleFilter);
    const _baseVis = _vis.filter(t => !t.isCalendarBooking);
    if (fTool)          _vis = _vis.filter(t => t.source === fTool);
    if (fStatus.length) _vis = _vis.filter(t => fStatus.includes(t.status));
    if (fUnassigned)    _vis = _vis.filter(t => !t.assigneeId && !t.assigneeEmail);
    const _visPreSla = _vis.filter(t => !t.isCalendarBooking);
    if (fSla === 'ok')       _vis = _vis.filter(t => { const s = slaInfo(t); return s && s.ok; });
    if (fSla === 'at_risk')  _vis = _vis.filter(t => { const s = slaInfo(t); return s && !s.ok && !s.breach; });
    if (fSla === 'breached') _vis = _vis.filter(t => { const s = slaInfo(t); return s && s.breach; });
    _vis = _vis.filter(t => !t.isCalendarBooking);
    if (search) { const sl = search.toLowerCase(); _vis = _vis.filter(t => t.subject.toLowerCase().includes(sl) || t.id.toLowerCase().includes(sl) || t.type.toLowerCase().includes(sl)); }

    // SLA tier for tickets — 0=breached, 1=at-risk, 2=on-track. Mirrors the
    // SLA pill counts so this sort and the pill counts agree on which row
    // is in which tier.
    const tier = (t) => {
      const s = slaInfo(t);
      if (!s) return 2;
      if (s.breach) return 0;
      if (!s.ok && !s.breach) return 1;
      return 2;
    };
    const ticketCreatedMs = (t) => {
      if (t.createdAt) {
        const ms = new Date(t.createdAt).getTime();
        if (Number.isFinite(ms)) return ms;
      }
      // Fallback: derive a creation timestamp from minutesAgo so rows without
      // an explicit createdAt still slot into the oldest-first secondary sort.
      if (Number.isFinite(t.minutesAgo)) return Date.now() - t.minutesAgo * 60000;
      return Number.POSITIVE_INFINITY;
    };
    // Tier (asc) → oldest first within tier. Used both as the SLA-column sort
    // and as the universal tie-break so a non-SLA primary still surfaces the
    // most-urgent row first inside each group.
    const compareTierThenAge = (a, b) => {
      const ta = tier(a), tb = tier(b);
      if (ta !== tb) return ta - tb;
      return ticketCreatedMs(a) - ticketCreatedMs(b);
    };
    const getColVal = (t) => {
      switch (sortCol) {
        case 'source':   return (t.source || '').toLowerCase();
        case 'subject':  return (t.subject || '').toLowerCase();
        case 'function': return (FUNCTIONS[t.type]?.label || t.type || '').toLowerCase();
        case 'country':  return (t.country || '').toLowerCase();
        case 'assignee': return ((resolveAssignee(t).name) || '').toLowerCase();
        case 'received': return ticketCreatedMs(t);
        case 'status':   return (t.status || '').toLowerCase();
        default: return 0; // 'sla' handled separately
      }
    };

    const sortArr = (arr) => {
      if (settings.sla_enabled === false) {
        return [...arr].sort((a, b) => ticketCreatedMs(a) - ticketCreatedMs(b));
      }
      const dir = sortDir === 'desc' ? -1 : 1;
      if (sortCol === 'sla') {
        return [...arr].sort((a, b) => compareTierThenAge(a, b) * dir);
      }
      return [...arr].sort((a, b) => {
        const av = getColVal(a), bv = getColVal(b);
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return compareTierThenAge(a, b);
      });
    };
    const _sorted = sortArr(_vis.filter(t => t.status !== 'resolved' && t.status !== 'waiting'));
    const _snoozed = _vis.filter(t => t.status === 'waiting');
    const _done = _vis.filter(t => t.status === 'resolved');
    const _all = [..._sorted, ..._snoozed, ..._done];
    return { baseVis: _baseVis, visPreSla: _visPreSla, active: _sorted, snoozed: _snoozed, done: _done, all: _all };
  }, [ns, user, fTool, fStatus, fUnassigned, fSla, search, settings.sla_enabled, passesJiraRoleFilter, sortCol, sortDir]);

  const jiraRoleFilterActive = fJiraActionable !== true || fJiraRaised !== false;
  const hasActiveFilters = useMemo(() => !!(fTool || fStatus.length > 0 || fSla || fUnassigned || search || jiraRoleFilterActive), [fTool, fStatus, fSla, fUnassigned, search, jiraRoleFilterActive]);

  // ── Source-panel filter (status severity + unassigned) ──
  // SLA filter is applied SEPARATELY (below) so the SLA pill counts stay
  // total — clicking the "At Risk" pill should narrow the table without
  // collapsing the pill counts to "0 / N / 0".
  const applyPanelFilter = useCallback((rows) => {
    let r = Array.isArray(rows) ? rows : [];
    if (fStatus.length) r = r.filter(row => fStatus.includes(row?.status?.severity));
    if (fUnassigned)    r = r.filter(row => !row?.assigneeEmail);
    return r;
  }, [fStatus, fUnassigned]);

  // Pre-computed post-status/unassigned row sets. Drive the SLA pill counts.
  const visOnboardingRows  = useMemo(() => applyPanelFilter(onboardingRows),  [onboardingRows, applyPanelFilter]);
  const visOffboardingRows = useMemo(() => applyPanelFilter(offboardingRows), [offboardingRows, applyPanelFilter]);
  const visAmendmentRows   = useMemo(() => applyPanelFilter(amendmentRows),   [amendmentRows, applyPanelFilter]);
  const visRedlineRows     = useMemo(() => applyPanelFilter(redlineRows),     [redlineRows, applyPanelFilter]);
  const visWorkbenchRows   = useMemo(() => applyPanelFilter(workbenchRows),   [workbenchRows, applyPanelFilter]);
  const visIncentivePlanRows = useMemo(() => applyPanelFilter(incentivePlanRows), [incentivePlanRows, applyPanelFilter]);

  // Per-source SLA severity classifier. At-risk = "less than 25% of the SLA
  // window remaining" — proportional to whatever active/paused window the
  // row is ticking against, so the band scales naturally when the Team-tab
  // SLA settings change. `slaWindowMs` is populated by normalizeSourceRows
  // for every Deel row; if it's missing for any reason we fall back to a
  // 6-hour static threshold (legacy behavior) so a sparse upstream payload
  // never silently turns at-risk classification off.
  const rowSlaSeverity = useCallback((row) => {
    if (!row) return 'ok';
    if (row.slaBreachStatus === 'SLA_BREACHED' || (typeof row.slaRemaining === 'number' && row.slaRemaining <= 0)) return 'breached';
    if (typeof row.slaRemaining !== 'number') return 'ok';
    const windowSeconds = Number.isFinite(row.slaWindowMs) && row.slaWindowMs > 0
      ? row.slaWindowMs / 1000
      : 24 * 60 * 60;
    const atRiskCutoff = windowSeconds / 4;
    return row.slaRemaining > 0 && row.slaRemaining < atRiskCutoff ? 'at_risk' : 'ok';
  }, []);

  // Apply the SLA pill on top of the post-status/unassigned row set. These
  // are what the SourceTable actually renders, while the `vis*` arrays above
  // remain available for total counts.
  const applySlaFilter = useCallback((rows) => {
    if (!fSla) return rows;
    return rows.filter(r => rowSlaSeverity(r) === fSla);
  }, [fSla, rowSlaSeverity]);

  const tblOnboardingRows  = useMemo(() => applySlaFilter(visOnboardingRows),  [visOnboardingRows,  applySlaFilter]);
  const tblOffboardingRows = useMemo(() => applySlaFilter(visOffboardingRows), [visOffboardingRows, applySlaFilter]);
  const tblAmendmentRows   = useMemo(() => applySlaFilter(visAmendmentRows),   [visAmendmentRows,   applySlaFilter]);
  const tblRedlineRows     = useMemo(() => applySlaFilter(visRedlineRows),     [visRedlineRows,     applySlaFilter]);
  const tblWorkbenchRows   = useMemo(() => applySlaFilter(visWorkbenchRows),   [visWorkbenchRows,   applySlaFilter]);
  const tblIncentivePlanRows = useMemo(() => applySlaFilter(visIncentivePlanRows), [visIncentivePlanRows, applySlaFilter]);

  // Tally a row set into { atRisk, breached, onTrack } using the proportional
  // at-risk band (windowMs/4). Mirrors rowSlaSeverity exactly so pill counts,
  // table filtering, and the per-row pill tier never disagree.
  const tallyDeelSla = useCallback((rows) => {
    let atRisk = 0, breached = 0;
    for (const r of rows) {
      const sev = rowSlaSeverity(r);
      if (sev === 'breached') breached++;
      else if (sev === 'at_risk') atRisk++;
    }
    return { atRiskCount: atRisk, breachedCount: breached, onTrackCount: rows.length - atRisk - breached };
  }, [rowSlaSeverity]);

  // ── SLA pills counts — reflect post-filter row sets per active tab ──
  const { atRiskCount, breachedCount, onTrackCount } = useMemo(() => {
    if (workSource === 'onboarding')      return tallyDeelSla(visOnboardingRows);
    if (workSource === 'offboarding')     return tallyDeelSla(visOffboardingRows);
    if (workSource === 'amendments')      return tallyDeelSla(visAmendmentRows);
    if (workSource === 'redlines')        return tallyDeelSla(visRedlineRows);
    if (workSource === 'workbench')       return tallyDeelSla(visWorkbenchRows);
    if (workSource === 'incentive_plans') return tallyDeelSla(visIncentivePlanRows);
    let slaBase;
    if (workSource === 'jira') slaBase = visPreSla.filter(t => t.source === 'jira');
    else if (workSource === 'zendesk') slaBase = visPreSla.filter(t => t.source === 'zendesk');
    else slaBase = visPreSla;
    slaBase = slaBase.filter(t => t.status !== 'resolved' && t.status !== 'waiting');
    const atRisk = slaBase.filter(t => { const s = slaInfo(t); return s && !s.ok && !s.breach; }).length;
    const breached = slaBase.filter(t => { const s = slaInfo(t); return s && s.breach; }).length;
    return { atRiskCount: atRisk, breachedCount: breached, onTrackCount: slaBase.length - atRisk - breached };
  }, [workSource, visPreSla, visOnboardingRows, visOffboardingRows, visAmendmentRows, visRedlineRows, visWorkbenchRows, visIncentivePlanRows, tallyDeelSla]);

  // ── View-aware header counts ──
  // For each Deel source we read the SLA-filtered row set so the "N open"
  // badge tracks what the user actually sees in the table, and the existing
  // `hiddenByFilters` indicator can show how many rows the SLA pill hid.
  const headerCounts = useMemo(() => {
    if (workSource === 'onboarding')      return { open: tblOnboardingRows.length,    paused: 0, resolved: 0 };
    if (workSource === 'offboarding')     return { open: tblOffboardingRows.length,   paused: 0, resolved: 0 };
    if (workSource === 'amendments')      return { open: tblAmendmentRows.length,     paused: 0, resolved: 0 };
    if (workSource === 'redlines')        return { open: tblRedlineRows.length,       paused: 0, resolved: 0 };
    if (workSource === 'workbench')       return { open: tblWorkbenchRows.length,     paused: 0, resolved: 0 };
    if (workSource === 'incentive_plans') return { open: tblIncentivePlanRows.length, paused: 0, resolved: 0 };
    const sourceOpen = fTool ? 0 : (
      tblOnboardingRows.length + tblOffboardingRows.length + tblAmendmentRows.length
      + tblRedlineRows.length + tblWorkbenchRows.length + tblIncentivePlanRows.length
    );
    return {
      open: active.length + sourceOpen,
      paused: snoozed.length,
      resolved: done.length,
    };
  }, [workSource, fTool, active, snoozed, done, tblOnboardingRows, tblOffboardingRows, tblAmendmentRows, tblRedlineRows, tblWorkbenchRows, tblIncentivePlanRows]);

  const rawCounts = useMemo(() => {
    if (workSource === 'onboarding')      return { open: onboardingRows.length };
    if (workSource === 'offboarding')     return { open: offboardingRows.length };
    if (workSource === 'amendments')      return { open: amendmentRows.length };
    if (workSource === 'redlines')        return { open: redlineRows.length };
    if (workSource === 'workbench')       return { open: workbenchRows.length };
    if (workSource === 'incentive_plans') return { open: incentivePlanRows.length };
    const base = fTool ? baseVis.filter(t => t.source === fTool) : baseVis;
    const srcExtra = fTool ? 0 : allSourceRows.length;
    return {
      open: base.filter(t => t.status !== 'resolved' && t.status !== 'waiting').length + srcExtra,
    };
  }, [workSource, fTool, baseVis, allSourceRows, onboardingRows, offboardingRows, amendmentRows, redlineRows, workbenchRows, incentivePlanRows]);
  const hiddenByFilters = Math.max(0, rawCounts.open - headerCounts.open);

  // Persist filters to localStorage — user-scoped so two people on the
  // same browser keep their own filter state.
  useEffect(() => {
    try {
      localStorage.setItem(
        queueFiltersKey(user?.email),
        JSON.stringify({ fTool, fStatus, fSla, fUnassigned, fJiraActionable, fJiraRaised }),
      );
    } catch {}
  }, [user?.email, fTool, fStatus, fSla, fUnassigned, fJiraActionable, fJiraRaised]);

  // Flatten Active → SNOOZED header → snoozed → DONE header → done into
  // one virtual list. Each item carries `kind: 'row' | 'header'`; both
  // render at TICKET_ROW_HEIGHT so the windowing math is uniform. With
  // Jira at 3,046 active rows, this drops the rendered DOM from ~27k
  // nodes to ~270 — repaint becomes O(viewport), not O(rows).
  const ticketVirtualItems = useMemo(() => {
    const out = active.map(t => ({ kind: 'row', row: t }));
    if (snoozed.length > 0) {
      out.push({ kind: 'header', label: 'PAUSED', color: '#6b6560', bg: '#faf9f7', icon: 'bi-pause-circle-fill', count: snoozed.length });
      for (const t of snoozed) out.push({ kind: 'row', row: t });
    }
    if (done.length > 0) {
      out.push({ kind: 'header', label: 'RESOLVED TODAY', color: '#29811e', bg: '#f9faf8', icon: 'bi-check-circle', count: done.length });
      for (const t of done) out.push({ kind: 'row', row: t });
    }
    return out;
  }, [active, snoozed, done]);
  // Add 1 for the new Actions column we render at the end of the row.
  const ticketColSpan = (settings.sla_enabled !== false ? 9 : 8) + 1;
  const { startIdx: ticketStart, endIdx: ticketEnd, topPad: ticketTopPad, bottomPad: ticketBottomPad } = useVirtualRows({
    rowCount: ticketVirtualItems.length,
    rowHeight: TICKET_ROW_HEIGHT,
    overscan: 8,
    scrollerRef: ticketScrollerRef,
  });
  const ticketVisible = ticketVirtualItems.slice(ticketStart, ticketEnd);

  // SLA-based row color
  const slaAgeClass = (task) => {
    if (task.status === 'resolved' || task.status === 'waiting') return '';
    const lim = SLA_MINS[task.type] || 1440;
    const rem = lim - (task.minutesSinceLastResponse ?? task.minutesAgo);
    if (rem <= 0) return 'age-urgent';
    const pct = rem / lim;
    if (pct > 0.5) return '';
    if (pct > 0.1) return 'age-warn';
    return 'age-hot';
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Single Header ── */}
      <div data-role="queue-header" style={{ padding: '8px 32px 12px', background: 'var(--surface)', borderBottom: '1px solid #e8e8e8', flexShrink: 0 }}>
        {/* Line 1: SLA pills (left) · Title/totals · Sync button (right) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <div onClick={() => setFSla(fSla === 'ok' ? null : 'ok')} title="Filter by SLA: On Track" role="button" tabIndex={0} style={{ display: 'flex', alignItems: 'center', gap: 5, background: fSla === 'ok' ? '#dcfce7' : '#f0fdf4', border: `${fSla === 'ok' ? '2' : '1'}px solid ${fSla === 'ok' ? '#15803d' : '#bbf7d0'}`, borderRadius: 128, padding: '5px 14px', cursor: 'pointer', transition: 'all .15s', flexShrink: 0, boxShadow: fSla === 'ok' ? '0 0 0 2px #15803d30' : 'none' }}>
            <i className="bi-check-circle-fill" style={{ color: '#15803d', fontSize: 13 }}></i>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#166534' }}>{onTrackCount}</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: '#166534' }}>On Track</span>
          </div>
          <div onClick={() => setFSla(fSla === 'at_risk' ? null : 'at_risk')} title="Filter by SLA: At Risk" role="button" tabIndex={0} style={{ display: 'flex', alignItems: 'center', gap: 5, background: fSla === 'at_risk' ? '#fef3c7' : '#fff8e6', border: `${fSla === 'at_risk' ? '2' : '1'}px solid ${fSla === 'at_risk' ? '#ed8d00' : '#ffe27c'}`, borderRadius: 128, padding: '5px 14px', cursor: 'pointer', transition: 'all .15s', flexShrink: 0, boxShadow: fSla === 'at_risk' ? '0 0 0 2px #ed8d0030' : 'none' }}>
            <i className="bi-exclamation-circle-fill" style={{ color: '#ed8d00', fontSize: 13 }}></i>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#92400E' }}>{atRiskCount}</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: '#92400E' }}>At Risk</span>
          </div>
          <div onClick={() => setFSla(fSla === 'breached' ? null : 'breached')} title="Filter by SLA: Breached" role="button" tabIndex={0} style={{ display: 'flex', alignItems: 'center', gap: 5, background: fSla === 'breached' ? '#fecaca' : '#ffe2de', border: `${fSla === 'breached' ? '2' : '1'}px solid ${fSla === 'breached' ? '#d42d35' : '#fca5a5'}`, borderRadius: 128, padding: '5px 14px', cursor: 'pointer', transition: 'all .15s', flexShrink: 0, boxShadow: fSla === 'breached' ? '0 0 0 2px #d42d3530' : 'none' }}>
            <i className="bi-x-circle-fill" style={{ color: '#d42d35', fontSize: 13 }}></i>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#991b1b' }}>{breachedCount}</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: '#991b1b' }}>Breached</span>
          </div>

          {(isAdmin || isLead) && (() => {
            const sourceLabels = { onboarding: 'Onboarding', offboarding: 'Offboarding', amendments: 'Amendments', redlines: 'Redlines', workbench: 'Workbench', incentive_plans: 'Incentive Plans' };
            const toolLabels = { zendesk: 'Zendesk', jira: 'Jira' };
            const viewLabel = sourceLabels[workSource] || toolLabels[fTool] || (isAdmin ? 'All Tasks' : user.team);
            return <span style={{ fontSize: 13, fontWeight: 600, color: '#616161', marginLeft: 6 }}>{viewLabel}</span>;
          })()}
          <span style={{ fontSize: 12, color: '#9e9e9e', display: 'flex', alignItems: 'center', gap: 5 }}>
            <i className="bi-layers" style={{ fontSize: 11 }}></i>
            <span style={{ fontWeight: 600, color: '#1b1b1b' }}>{headerCounts.open}</span> open
            {headerCounts.paused > 0 && <span> &middot; <span style={{ fontWeight: 600, color: '#616161' }}>{headerCounts.paused}</span> paused</span>}
            {headerCounts.resolved > 0 && <span> &middot; <span style={{ fontWeight: 600, color: '#29811e' }}>{headerCounts.resolved}</span> resolved</span>}
          </span>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <UnifiedSyncButton
              meta={syncMeta}
              sources={syncSources}
              onRefresh={syncRefreshAll}
              nowTick={syncNowTick}
            />
          </div>
        </div>

        {/* Line 2: Q-buttons + Status filter + Unassigned + Jira filters + Clear */}
        {(() => {
          const applyQueueFilter = (t) => {
            if (t.status === 'resolved') return false;
            if (fStatus.length && !fStatus.includes(t.status)) return false;
            if (fUnassigned && (t.assigneeId || t.assigneeEmail)) return false;
            return true;
          };
          const jiraCount = baseVis.filter(t => t.source === 'jira' && applyQueueFilter(t)).length;
          const zdCount = baseVis.filter(t => t.source === 'zendesk' && applyQueueFilter(t)).length;
          const isSourcePanel = !!workSource && workSource !== 'jira' && workSource !== 'zendesk';
          const severityMeta = {
            critical: { label: 'Critical', dotColor: '#d42d35' },
            warning:  { label: 'Action Needed', dotColor: '#ed8d00' },
            active:   { label: 'In Progress', dotColor: '#1d4ed8' },
            info:     { label: 'Other', dotColor: '#616161' },
          };
          let statusOptions;
          if (isSourcePanel) {
            const rowsForPanel =
              workSource === 'onboarding' ? onboardingRows
              : workSource === 'offboarding' ? offboardingRows
              : workSource === 'amendments' ? amendmentRows
              : workSource === 'redlines' ? redlineRows
              : workSource === 'workbench' ? workbenchRows
              : workSource === 'incentive_plans' ? incentivePlanRows
              : [];
            const present = new Set(rowsForPanel.map(r => r?.status?.severity).filter(Boolean));
            statusOptions = ['critical', 'warning', 'active', 'info']
              .filter(k => present.has(k))
              .map(k => ({ value: k, ...severityMeta[k] }));
          } else {
            statusOptions = [
              { value: 'new', label: 'New', dotColor: '#7c3aed' },
              { value: 'in_progress', label: 'In Progress', dotColor: '#1d4ed8' },
              { value: 'waiting', label: 'Pause', dotColor: '#6b6560' },
              { value: 'escalated', label: 'Escalated', dotColor: '#d42d35' },
              { value: 'resolved', label: 'Resolved', dotColor: '#15803d' },
            ];
          }
          return (
            // overflow:visible + flex-wrap so the Status filter popover (which
            // is position:absolute) is not clipped by the parent's scroll
            // context. The previous overflow:auto silently swallowed the menu;
            // wrap also gives narrow desktops / tablets a usable layout instead
            // of a horizontal-scroll filter row.
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', overflow: 'visible', paddingBottom: 2 }}>
              {WORK_SOURCES.map(ws => {
                const isQueueFilter = ws.id === 'zendesk' || ws.id === 'jira';
                const isActive = isQueueFilter ? (fTool === ws.id && !workSource) : workSource === ws.id;
                const count = ws.id === 'onboarding' ? visOnboardingRows.length
                  : ws.id === 'offboarding' ? visOffboardingRows.length
                  : ws.id === 'amendments' ? visAmendmentRows.length
                  : ws.id === 'redlines' ? visRedlineRows.length
                  : ws.id === 'workbench' ? visWorkbenchRows.length
                  : ws.id === 'incentive_plans' ? visIncentivePlanRows.length
                  : ws.id === 'jira' ? jiraCount
                  : ws.id === 'zendesk' ? zdCount
                  : 0;
                const handleClick = () => {
                  if (isQueueFilter) {
                    setWorkSource(null);
                    setFTool(fTool === ws.id ? null : ws.id);
                  } else {
                    setFTool(null);
                    setWorkSource(isActive ? null : ws.id);
                  }
                };
                const sourceSync = syncSources?.[ws.id];
                const sourceFailing = !!sourceSync?.error && !sourceSync?.isRefreshing;
                const failingTitle = sourceFailing
                  ? `${ws.label} sync is currently failing — count may be stale`
                  : undefined;
                return (
                  <button key={ws.id} onClick={handleClick} title={failingTitle}
                    style={{
                      height: 34, display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '0 14px', borderRadius: 10,
                      border: isActive ? `1.5px solid ${ws.color}` : '1px solid #e8e8e8',
                      background: isActive ? ws.bg : 'white',
                      color: isActive ? ws.color : '#616161',
                      fontSize: 12, fontWeight: isActive ? 700 : 500, cursor: 'pointer',
                      transition: 'all .15s', whiteSpace: 'nowrap',
                      boxShadow: isActive ? `0 1px 4px ${ws.color}18` : 'none',
                      position: 'relative',
                    }}>
                    <i className={ws.icon} style={{ fontSize: 12 }}></i>
                    {ws.label}
                    <span style={{
                      padding: '1px 7px', borderRadius: 128, fontSize: 10, fontWeight: 700,
                      background: isActive ? `${ws.color}20` : '#f2f2f2',
                      color: isActive ? ws.color : '#9e9e9e',
                    }}>{count}</span>
                    {sourceFailing && (
                      <span aria-label="Sync failing" style={{
                        width: 7, height: 7, borderRadius: '50%', background: '#d42d35',
                        boxShadow: '0 0 0 2px white', position: 'absolute', top: 4, right: 4,
                      }}/>
                    )}
                  </button>
                );
              })}

              <div style={{ width: 1, height: 20, background: '#e8e8e8', flexShrink: 0, margin: '0 4px' }}></div>

              <MultiFilterDropdown
                icon="bi-circle"
                label="Status"
                selected={fStatus}
                options={statusOptions}
                onChange={setFStatus}
                activeColor="#7c3aed"
              />

              <button onClick={() => setFUnassigned(!fUnassigned)} style={{ height: 32, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 12px', borderRadius: 8, border: fUnassigned ? '1px solid #d42d35' : '1px solid #e8e8e8', background: fUnassigned ? '#fef2f2' : 'white', color: fUnassigned ? '#d42d35' : '#616161', fontSize: 12, fontWeight: fUnassigned ? 600 : 500, cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap' }}>
                <i className="bi-person-dash" style={{ fontSize: 11 }}></i>Unassigned
              </button>

              {fTool === 'jira' && !workSource && (
                <>
                  <div style={{ width: 1, height: 20, background: '#e8e8e8', flexShrink: 0, margin: '0 4px' }} />
                  <button
                    onClick={() => setFJiraActionable(v => !v)}
                    title="Tickets where you (or someone on your team) are the assignee or HRX Responsible"
                    style={{ height: 32, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 12px', borderRadius: 8, border: fJiraActionable ? '1px solid #2563eb' : '1px solid #e8e8e8', background: fJiraActionable ? '#eff6ff' : 'white', color: fJiraActionable ? '#2563eb' : '#616161', fontSize: 12, fontWeight: fJiraActionable ? 600 : 500, cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap' }}>
                    <i className="bi-check2-circle" style={{ fontSize: 11 }}></i>Actionable
                  </button>
                  <button
                    onClick={() => setFJiraRaised(v => !v)}
                    title="Tickets where you (or someone on your team) are the reporter"
                    style={{ height: 32, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 12px', borderRadius: 8, border: fJiraRaised ? '1px solid #7c3aed' : '1px solid #e8e8e8', background: fJiraRaised ? '#f5f3ff' : 'white', color: fJiraRaised ? '#7c3aed' : '#616161', fontSize: 12, fontWeight: fJiraRaised ? 600 : 500, cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap' }}>
                    <i className="bi-megaphone" style={{ fontSize: 11 }}></i>Raised by You
                  </button>
                </>
              )}

              {hasActiveFilters && hiddenByFilters > 0 && (
                <button
                  type="button"
                  onClick={() => { setFTool(null); setFStatus([]); setFSla(null); setFUnassigned(false); setSearch(''); setFJiraActionable(true); setFJiraRaised(false); }}
                  title={`Your active filters are hiding ${hiddenByFilters} ${hiddenByFilters === 1 ? 'task' : 'tasks'}. Click to clear all filters.`}
                  style={{ height: 32, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 10px', borderRadius: 8, background: '#fff7ed', border: '1px solid #fed7aa', color: '#b45309', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer', fontFamily: 'inherit' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#ffedd5'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#fff7ed'; }}
                >
                  <i className="bi-funnel-fill" style={{ fontSize: 10 }}></i>
                  {hiddenByFilters} hidden — click to clear
                </button>
              )}

              {hasActiveFilters && (
                <button onClick={() => { setFTool(null); setFStatus([]); setFSla(null); setFUnassigned(false); setSearch(''); setFJiraActionable(true); setFJiraRaised(false); }} style={{ height: 32, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 10px', borderRadius: 8, border: 'none', background: 'transparent', color: '#9e9e9e', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'underline' }}>
                  Clear all
                </button>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── Source panels — all use SourceTable ── */}
      {workSource === 'onboarding' && (
        <ErrorBoundary>
          <SourceTable
            viewerEmail={user?.email}
            rows={tblOnboardingRows}
            loading={onboardingData.loading || pausedOnboardingData.loading}
            error={onboardingData.error || pausedOnboardingData.error}
            onRefresh={() => { onboardingData.refresh && onboardingData.refresh(); pausedOnboardingData.refresh && pausedOnboardingData.refresh(); }}
            emptyIcon="bi-person-plus"
            emptyLabel="No onboarding tasks"
            emptySubLabel="Nothing action-needed or paused"
            sortDefault="sla"
            showPausedSla
            hideStatusPills
            showClient
            onHide={(row) => setHideModalTask({ source: 'onboarding', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onEscalate={(row) => setEscalateModalTask({ source: 'onboarding', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onReassign={canReassign ? (row) => setReassignModalTask({ source: 'onboarding', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country, assigneeEmail: row.assigneeEmail || null, assigneeName: row.assignee || null, hasOverride: !!row.reassignedFromEmail }) : null}
            onBulkHide={(rows) => setBulkHideTasks(rows.map(r => buildTaskDescriptor(r, 'onboarding')))}
            onBulkReassign={canReassign ? (rows) => setBulkReassignTasks(rows.map(r => buildTaskDescriptor(r, 'onboarding'))) : null}
          />
        </ErrorBoundary>
      )}
      {workSource === 'offboarding' && (
        <ErrorBoundary>
          <SourceTable
            viewerEmail={user?.email}
            rows={tblOffboardingRows}
            loading={offboardingData.loading}
            error={offboardingData.error}
            onRefresh={offboardingData.refresh}
            emptyIcon="bi-person-dash"
            emptyLabel="No active offboarding cases"
            emptySubLabel="All termination cases have been resolved"
            sortDefault="sla"
            dateField="endDate"
            dateLabel="End Date"
            showClient
            showType
            onHide={(row) => setHideModalTask({ source: 'offboarding', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onEscalate={(row) => setEscalateModalTask({ source: 'offboarding', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onBulkHide={(rows) => setBulkHideTasks(rows.map(r => buildTaskDescriptor(r, 'offboarding')))}
            hideFilterBar
          />
        </ErrorBoundary>
      )}
      {workSource === 'amendments' && (
        <ErrorBoundary>
          <SourceTable
            viewerEmail={user?.email}
            rows={tblAmendmentRows}
            loading={changeRequestData.loading}
            error={changeRequestData.error}
            onRefresh={changeRequestData.refresh}
            emptyIcon="bi-pencil-square"
            emptyLabel="No amendments"
            emptySubLabel="Nothing action-needed or paused"
            sortDefault="sla"
            showPausedSla
            showClient
            hideStatusPills
            hideUpdated
            dateField="createdAt"
            dateLabel="Requested Date"
            onHide={(row) => setHideModalTask({ source: 'amendments', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onEscalate={(row) => setEscalateModalTask({ source: 'amendments', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onReassign={canReassign ? (row) => setReassignModalTask({ source: 'amendments', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country, assigneeEmail: row.assigneeEmail || null, assigneeName: row.assignee || null, hasOverride: !!row.reassignedFromEmail }) : null}
            onBulkHide={(rows) => setBulkHideTasks(rows.map(r => buildTaskDescriptor(r, 'amendments')))}
            onBulkReassign={canReassign ? (rows) => setBulkReassignTasks(rows.map(r => buildTaskDescriptor(r, 'amendments'))) : null}
          />
        </ErrorBoundary>
      )}
      {workSource === 'redlines' && (
        <ErrorBoundary>
          <SourceTable
            viewerEmail={user?.email}
            rows={tblRedlineRows}
            loading={changeRequestData.loading}
            error={changeRequestData.error}
            onRefresh={changeRequestData.refresh}
            emptyIcon="bi-file-earmark-diff"
            emptyLabel="No actionable redlines"
            emptySubLabel="All redlines are handled"
            sortDefault="sla"
            showClient
            hideStatusPills
            hideUpdated
            hideContract
            dateField="createdAt"
            dateLabel="Requested Date"
            onHide={(row) => setHideModalTask({ source: 'redlines', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onEscalate={(row) => setEscalateModalTask({ source: 'redlines', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onReassign={canReassign ? (row) => setReassignModalTask({ source: 'redlines', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country, assigneeEmail: row.assigneeEmail || null, assigneeName: row.assignee || null, hasOverride: !!row.reassignedFromEmail }) : null}
            onBulkHide={(rows) => setBulkHideTasks(rows.map(r => buildTaskDescriptor(r, 'redlines')))}
            onBulkReassign={canReassign ? (rows) => setBulkReassignTasks(rows.map(r => buildTaskDescriptor(r, 'redlines'))) : null}
          />
        </ErrorBoundary>
      )}
      {workSource === 'workbench' && (
        <ErrorBoundary>
          <SourceTable
            viewerEmail={user?.email}
            rows={tblWorkbenchRows}
            loading={workbenchData.loading}
            error={workbenchData.error}
            onRefresh={workbenchData.refresh}
            emptyIcon="bi-grid-3x3-gap"
            emptyLabel="No workbench tasks"
            emptySubLabel="All HRX Operations tasks are processed"
            sortDefault="sla"
            showType
            hideUpdated
            hideContract
            hideStatusPills
            dateField="createdAt"
            dateLabel="Created"
            onHide={(row) => setHideModalTask({ source: 'workbench', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onEscalate={(row) => setEscalateModalTask({ source: 'workbench', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onBulkHide={(rows) => setBulkHideTasks(rows.map(r => buildTaskDescriptor(r, 'workbench')))}
          />
        </ErrorBoundary>
      )}
      {workSource === 'incentive_plans' && (
        <ErrorBoundary>
          <SourceTable
            viewerEmail={user?.email}
            rows={tblIncentivePlanRows}
            loading={incentivePlansData.loading}
            error={incentivePlansData.error}
            onRefresh={incentivePlansData.refresh}
            emptyIcon="bi-cash-coin"
            emptyLabel="No incentive plans"
            emptySubLabel="Nothing pending IP preparation"
            sortDefault="sla"
            showClient
            hideStatusPills
            hideUpdated
            dateField="createdAt"
            dateLabel="Requested Date"
            onHide={(row) => setHideModalTask({ source: 'incentive_plans', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onEscalate={(row) => setEscalateModalTask({ source: 'incentive_plans', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onReassign={canReassign ? (row) => setReassignModalTask({ source: 'incentive_plans', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country, assigneeEmail: row.assigneeEmail || null, assigneeName: row.assignee || null, hasOverride: !!row.reassignedFromEmail }) : null}
            onBulkHide={(rows) => setBulkHideTasks(rows.map(r => buildTaskDescriptor(r, 'incentive_plans')))}
            onBulkReassign={canReassign ? (rows) => setBulkReassignTasks(rows.map(r => buildTaskDescriptor(r, 'incentive_plans'))) : null}
          />
        </ErrorBoundary>
      )}

      {/* ── Main ZD/JR table (when no work source is active) ── */}
      {!workSource && (
        <div ref={ticketScrollerRef} style={{ flex: 1, overflowY: 'auto', background: '#fafaf9' }}>
          {all.length === 0 ? (
            hasActiveFilters
              ? <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                  <i className="bi bi-inbox" style={{ fontSize: 32, display: 'block', marginBottom: 12, opacity: 0.3 }}/>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#616161', marginBottom: 4 }}>No tasks found</div>
                  {hiddenByFilters > 0 ? (
                    <>
                      <div style={{ fontSize: 13, color: '#9e9e9e', marginBottom: 16 }}>
                        Your active filters are hiding {hiddenByFilters} {hiddenByFilters === 1 ? 'task' : 'tasks'} in your scope.
                      </div>
                      <button
                        type="button"
                        onClick={() => { setFTool(null); setFStatus([]); setFSla(null); setFUnassigned(false); setSearch(''); setFJiraActionable(true); setFJiraRaised(false); }}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: '1px solid #1f74b3', background: '#1f74b3', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        <i className="bi-x-circle" style={{ fontSize: 12 }}></i>
                        Clear filters
                      </button>
                    </>
                  ) : (
                    <div style={{ fontSize: 13, color: '#9e9e9e' }}>Try adjusting your filters</div>
                  )}
                </div>
              : <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: 40, textAlign: 'center', minHeight: 300 }}>
                  <i className="bi-inbox" style={{ fontSize: 48, color: '#c0c0c0', display: 'block', marginBottom: 16 }}></i>
                  <div style={{ fontSize: 17, fontWeight: 600, color: '#1b1b1b', marginBottom: 6 }}>Queue is clear</div>
                  <div style={{ fontSize: 14, color: '#9e9e9e' }}>All caught up</div>
                </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} role="grid" aria-label="Task queue">
              <thead>
                <tr style={{ background: '#f5f4f2', position: 'sticky', top: 0, zIndex: 2 }}>
                  <SortableTh col="source"   label="Source"   width={80}  sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh col="subject"  label="Subject"  minWidth={200} align="left" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh col="function" label="Function" width={90}  sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh col="country"  label="Country"  width={50}  sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh col="assignee" label="Assignee" width={80}  sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh col="received" label="Received" width={68}  sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                  {settings.sla_enabled !== false && (
                    <SortableTh col="sla" label="SLA" width={60} sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} tooltip="Sorted by triage tier first (Breached → At Risk → On Track), then oldest within each tier — not by raw SLA value. Hover any row's SLA pill for the exact remaining/over time." />
                  )}
                  <SortableTh col="status"   label="Status"   width={90}  sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                  <th scope="col" style={{ ...thStyle, width: 60 }}>Link</th>
                  <th scope="col" style={{ ...thStyle, width: 160 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {ticketTopPad > 0 && (
                  <tr style={{ height: ticketTopPad }} aria-hidden="true">
                    <td colSpan={ticketColSpan} style={{ padding: 0, height: ticketTopPad }} />
                  </tr>
                )}
                {ticketVisible.map((it, i) => {
                  if (it.kind === 'header') {
                    return (
                      <tr key={`hdr-${ticketStart + i}-${it.label}`} style={{ height: TICKET_ROW_HEIGHT }}>
                        <td colSpan={ticketColSpan} style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: it.color, letterSpacing: '.04em', background: it.bg, borderTop: '1px solid #e8e8e8', borderBottom: '1px solid #e8e8e8' }}>
                          <i className={it.icon} style={{ fontSize: 11, marginRight: 6 }}></i>
                          {it.label} ({it.count})
                        </td>
                      </tr>
                    );
                  }
                  const task = it.row;
                  const taskDescriptor = {
                    source: task.source,
                    id: String(task.id),
                    url: getUrl(task) || null,
                    subject: task.subject,
                    country: task.country,
                  };
                  return <QueueRow
                    key={task.id}
                    task={task}
                    slaAgeClass={slaAgeClass}
                    settings={settings}
                    onHide={() => setHideModalTask(taskDescriptor)}
                    onEscalate={() => setEscalateModalTask(taskDescriptor)}
                  />;
                })}
                {ticketBottomPad > 0 && (
                  <tr style={{ height: ticketBottomPad }} aria-hidden="true">
                    <td colSpan={ticketColSpan} style={{ padding: 0, height: ticketBottomPad }} />
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Hide-task request modal — opens from any row's Hide button. The
          local refresh nonce on success calls hiddenTasks.refresh() so the
          requester sees the row stay (still pending) until the manager
          approves. */}
      {hideModalTask && (
        <CreateHideTaskRequestModal
          task={hideModalTask}
          onClose={() => setHideModalTask(null)}
          onSubmitted={() => { try { hiddenTasks?.refresh?.(); } catch {} }}
        />
      )}

      {/* Escalate-to-HR-Hub modal — same Submit-to-HR-Hub picker the global
          + button opens, but pre-populated with the task URL, a suggested
          title, and the requester's manager as default assignee. The user
          still picks the flow (HR Request / Reporting / Escalation Zero /
          Feedback) and fills out the form. */}
      {escalateModalTask && (
        <CreateHrHubRequestModal
          initialFlow={null}
          prefill={escalatePrefill}
          onClose={() => setEscalateModalTask(null)}
          onCreated={() => setEscalateModalTask(null)}
        />
      )}

      {/* Source-row reassign modal — only opens for the four queues whose
          upstream source we cannot push assignments back to (Onboarding /
          Amendments / Redlines / Incentive Plans). On success we trigger
          syncRefreshAll so the row immediately moves to the new assignee's
          chain and any "Mine vs Others" buckets recompute. */}
      {reassignModalTask && (
        <ReassignTaskModal
          task={reassignModalTask}
          onClose={() => setReassignModalTask(null)}
          onReassigned={() => {
            setReassignModalTask(null);
            try { syncRefreshAll && syncRefreshAll(); } catch {}
          }}
        />
      )}

      {/* Bulk reassign — same modal in `tasks` (array) mode. One assignee
          fans out to N reassignments via Promise.allSettled; partial
          failures show inline. Refresh on close so the rows visually move
          to the new owner without a manual refetch. */}
      {bulkReassignTasks && bulkReassignTasks.length > 0 && (
        <ReassignTaskModal
          tasks={bulkReassignTasks}
          onClose={() => setBulkReassignTasks(null)}
          onReassigned={() => {
            setBulkReassignTasks(null);
            try { syncRefreshAll && syncRefreshAll(); } catch {}
          }}
        />
      )}

      {/* Bulk hide — same modal in `tasks` mode. The reason applies to
          every task; each becomes a separate approval row so a manager
          can deny one of a batch without rejecting the whole set. */}
      {bulkHideTasks && bulkHideTasks.length > 0 && (
        <CreateHideTaskRequestModal
          tasks={bulkHideTasks}
          onClose={() => setBulkHideTasks(null)}
          onSubmitted={() => { try { hiddenTasks?.refresh?.(); } catch {} }}
        />
      )}
    </div>
  );
};

// ── Table row component ──
const QueueRow = memo(({ task, slaAgeClass, settings, onHide, onEscalate }) => {
  const [hov, setHov] = useState(false);
  const assignee = resolveAssignee(task);
  const sla = slaInfo(task);
  const fn = FUNCTIONS[task.type];
  const rowAgeClass = slaAgeClass ? slaAgeClass(task) : '';
  const priColor = task.priority ? PRIORITY_DOT[task.priority] : null;
  const url = getUrl(task);

  return (
    <tr
      className={rowAgeClass}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ height: 44, borderBottom: '1px solid #f0efed', background: hov ? '#fafaf9' : 'white', transition: 'background 0.1s', borderLeft: priColor ? `3px solid ${priColor}` : '3px solid transparent' }}
    >
      {/* Source */}
      <td style={tdStyle}><ToolBadge source={task.source}/></td>
      {/* Subject — full text in title attr so truncated subjects (Zendesk
          long-form messages, employee long names) are reachable on hover.
          Without this the user had to leave the app to read the full title. */}
      <td title={task.subject || ''} style={{ ...tdStyle, textAlign: 'left', fontWeight: 600, color: '#1b1b1b', maxWidth: 320 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {task.isAlert && <span className="pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: '#ed8d00', flexShrink: 0 }}></span>}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.subject}</span>
          {task.linkedTickets && task.linkedTickets.length > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '1px 6px', borderRadius: 128, background: '#f2f2f2', fontSize: 10, color: '#616161', flexShrink: 0 }}>
              <i className="bi-link-45deg" style={{ fontSize: 9 }}></i>{task.linkedTickets.length}
            </span>
          )}
        </div>
      </td>
      {/* Function */}
      <td style={tdStyle}>
        {fn ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 128, background: fn.bg || '#f2f2f2', color: fn.color || '#616161', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>{fn.label}</span> : <span style={{ color: '#d5d5d5' }}>--</span>}
      </td>
      {/* Country — flag + ISO code, full name in title for hover. Standardised
          across tabs so users no longer see "🇩🇪 DE" on Zendesk and "🇩🇪 Germany"
          on Onboarding for the same country. */}
      <td title={task.country ? getCountryName(task.country) : ''} style={{ ...tdStyle, fontSize: 12 }}>
        {task.country && <span>{getFlag(task.country)} <span style={{ color: '#616161', fontWeight: 500 }}>{task.country}</span></span>}
      </td>
      {/* Assignee — full name in title attr; cell only displays first name. */}
      <td title={assignee.name || 'Unassigned'} style={tdStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
          <Avatar name={assignee.name} size="xs"/>
          <span style={{ fontSize: 12, color: '#1b1b1b', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{assignee.name?.split(' ')[0] || ''}</span>
        </div>
      </td>
      {/* Received */}
      <td style={{ ...tdStyle, fontSize: 12, color: '#616161', whiteSpace: 'nowrap' }}>{relTime(task.minutesAgo)}</td>
      {/* SLA */}
      {settings.sla_enabled !== false && <td style={tdStyle}><SlaBadge sla={sla} status={task.status}/></td>}
      {/* Status */}
      <td style={tdStyle}><StatusBadge status={task.status}/></td>
      {/* External link */}
      <td style={tdStyle}>
        <a href={url} target="_blank" rel="noreferrer"
          title={`Open in ${TOOLS[task.source]?.label || task.source}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6,
            background: hov ? '#e8f0fe' : '#f5f4f2', color: hov ? '#1f74b3' : '#9e9e9e',
            fontSize: 10, fontWeight: 600, textDecoration: 'none', transition: 'all .15s', whiteSpace: 'nowrap',
            border: hov ? '1px solid #c8d9f0' : '1px solid transparent' }}>
          <i className="bi-box-arrow-up-right" style={{ fontSize: 9 }}></i>
          <span style={{ fontSize: 10 }}>{task.id ? `${task.id}` : TOOLS[task.source]?.label || 'Open'}</span>
        </a>
      </td>
      {/* Actions */}
      <td style={tdStyle}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            onClick={() => onEscalate?.()}
            aria-label={`Escalate "${task.subject || task.id}" to HR Hub`}
            title="Escalate to HR Hub"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 8px', borderRadius: 6,
              background: hov ? '#f5f3ff' : '#f5f4f2',
              color: hov ? '#7c3aed' : '#9e9e9e',
              border: hov ? '1px solid #d4c4f0' : '1px solid transparent',
              fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <i className="bi-arrow-up-right-circle" style={{ fontSize: 9 }} />
            Escalate
          </button>
          <button
            type="button"
            onClick={() => onHide?.()}
            aria-label={`Hide task "${task.subject || task.id}"`}
            title="Request to hide this task"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 8px', borderRadius: 6,
              background: hov ? '#fef2f2' : '#f5f4f2',
              color: hov ? '#d42d35' : '#9e9e9e',
              border: hov ? '1px solid #fca5a5' : '1px solid transparent',
              fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <i className="bi-eye-slash" style={{ fontSize: 9 }} />
            Hide
          </button>
        </div>
      </td>
    </tr>
  );
});
QueueRow.displayName = 'QueueRow';

// ── Sortable table header — used by the ZD/Jira table to give every column
// a click-to-sort affordance. Pairs with the `sortCol` / `sortDir` state in
// the parent: clicking the same column toggles asc/desc, clicking a fresh
// column resets to asc. The chevron pair indicates the active column +
// direction; both stay light grey on inactive headers so users can see
// every column is sortable without the row turning into a row of arrows.
//
// `tooltip` is rendered as a `title` attribute and is used by the SLA column
// to explain that the sort is "tier-then-age" (Breached → At Risk → On Track,
// oldest first within tier) — the 2026-05-01 audit found users expected
// numeric "most-overdue first" sort and were confused when -9m came before
// -3h 43m. Other columns can pass an optional tooltip too.
const SortableTh = memo(function SortableTh({ col, label, width, minWidth, align, sortCol, sortDir, onSort, tooltip }) {
  const active = sortCol === col;
  const sortState = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(col); }
  };
  return (
    <th
      scope="col"
      role="columnheader"
      aria-sort={sortState}
      onClick={() => onSort(col)}
      onKeyDown={onKey}
      tabIndex={0}
      title={tooltip}
      style={{
        ...thStyle,
        ...(width ? { width } : null),
        ...(minWidth ? { minWidth } : null),
        ...(align ? { textAlign: align } : null),
        cursor: 'pointer',
        userSelect: 'none',
      }}
      aria-label={`Sort by ${label}${active ? `, currently ${sortState}` : ''}${tooltip ? ` — ${tooltip}` : ''}`}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        <span aria-hidden="true" style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1, gap: 0, fontSize: 7, marginTop: -1 }}>
          <i className="bi-caret-up-fill" style={{ color: active && sortDir === 'asc' ? '#1b1b1b' : '#ccc' }} />
          <i className="bi-caret-down-fill" style={{ color: active && sortDir === 'desc' ? '#1b1b1b' : '#ccc', marginTop: -3 }} />
        </span>
      </span>
    </th>
  );
});

// ── Multi-select filter dropdown (Status) ──
const MultiFilterDropdown = memo(({ icon, label, selected = [], options, onChange, activeColor = '#1f74b3', searchable }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);
  const inputRef = useRef(null);
  const isActive = selected.length > 0;
  const showSearch = searchable ?? (options.length >= 8);

  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  useEffect(() => {
    if (open && showSearch && inputRef.current) inputRef.current.focus();
  }, [open, showSearch]);

  const toggle = (value) => {
    if (selected.includes(value)) onChange(selected.filter(v => v !== value));
    else onChange([...selected, value]);
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter(o => (o.label || '').toLowerCase().includes(q) || String(o.value).toLowerCase().includes(q))
    : options;

  const displayLabel = isActive
    ? selected.length === 1
      ? (options.find(o => o.value === selected[0])?.label || label)
      : `${label} (${selected.length})`
    : label;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        height: 32, display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '0 12px', borderRadius: 8,
        border: isActive ? `1px solid ${activeColor}` : '1px solid #e8e8e8',
        background: isActive ? `${activeColor}10` : 'white',
        color: isActive ? activeColor : '#616161',
        fontSize: 12, fontWeight: isActive ? 600 : 500, cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap',
      }}>
        <i className={icon} style={{ fontSize: 11 }}></i>
        {displayLabel}
        <i className={open ? 'bi-chevron-up' : 'bi-chevron-down'} style={{ fontSize: 8, marginLeft: 2, opacity: 0.6 }}></i>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, background: 'var(--surface)', border: '1px solid #e8e8e8', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 200, minWidth: 260, maxHeight: 360, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {showSearch && (
            <div style={{ padding: '8px 10px', borderBottom: '1px solid #f2f2f2', display: 'flex', alignItems: 'center', gap: 6 }}>
              <i className="bi-search" style={{ fontSize: 11, color: '#9e9e9e' }}></i>
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); setOpen(false); } }}
                placeholder={`Search ${label.toLowerCase()}…`}
                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12, color: '#1b1b1b', background: 'transparent' }}
              />
              {query && (
                <i className="bi-x-circle-fill" onClick={() => setQuery('')}
                  style={{ fontSize: 11, color: '#9e9e9e', cursor: 'pointer' }}></i>
              )}
            </div>
          )}
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
            {isActive && (
              <div onClick={() => { onChange([]); setOpen(false); setQuery(''); }}
                style={{ padding: '8px 14px', fontSize: 12, color: '#9e9e9e', cursor: 'pointer', borderBottom: '1px solid #f2f2f2', display: 'flex', alignItems: 'center', gap: 6 }}
                onMouseEnter={e => e.currentTarget.style.background = '#f9f8f6'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <i className="bi-x-circle" style={{ fontSize: 11 }}></i>Clear selection
              </div>
            )}
            {filtered.length === 0 && (
              <div style={{ padding: '16px 14px', fontSize: 12, color: '#9e9e9e', textAlign: 'center' }}>
                No matches for &ldquo;{query}&rdquo;
              </div>
            )}
            {filtered.map(opt => {
              const checked = selected.includes(opt.value);
              return (
                <div key={opt.value} onClick={() => toggle(opt.value)}
                  onMouseEnter={e => { if (!checked) e.currentTarget.style.background = '#f9f8f6'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = checked ? `${activeColor}08` : 'transparent'; }}
                  style={{ padding: '8px 14px', fontSize: 13, color: checked ? activeColor : '#1b1b1b', fontWeight: checked ? 600 : 400, cursor: 'pointer', background: checked ? `${activeColor}08` : 'transparent', display: 'flex', alignItems: 'center', gap: 8, transition: 'background .1s' }}>
                  <span style={{ width: 16, height: 16, borderRadius: 4, border: checked ? `2px solid ${activeColor}` : '2px solid #d5d5d5', background: checked ? activeColor : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
                    {checked && <i className="bi-check2" style={{ fontSize: 10, color: 'white' }}></i>}
                  </span>
                  {opt.dotColor && <span style={{ width: 8, height: 8, borderRadius: '50%', background: opt.dotColor, flexShrink: 0 }}></span>}
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</span>
                  {typeof opt.count === 'number' && (
                    <span style={{ fontSize: 11, color: checked ? activeColor : '#9e9e9e', fontWeight: 500, flexShrink: 0, marginLeft: 8 }}>{opt.count}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});
MultiFilterDropdown.displayName = 'MultiFilterDropdown';

// ── Styles ──
const thStyle = { padding: '10px 12px', fontSize: 11, fontWeight: 600, color: '#9e9e9e', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid #e8e8e8' };
const tdStyle = { padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' };

export default Queue;
