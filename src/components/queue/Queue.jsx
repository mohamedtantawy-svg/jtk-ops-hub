import { useState, useEffect, useRef, useCallback, useMemo, useContext, memo } from 'react';
import { TOOLS, FUNCTIONS, SLA_MINS, getFlag, getCountryName } from '../../data/constants';
import { useVirtualRows } from '../../hooks/useVirtualRows';

// Same row-height contract as SourceTable — every <QueueRow /> inline-locks
// its <tr> to 44px so the windowing math stays accurate even when Jira's
// 3,000+ rows are in the dataset.
const TICKET_ROW_HEIGHT = 44;
import { MEMBERS_BY_EMAIL } from '../../data/members';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { useMyActiveCoverages, expandCoverageScope } from '../../hooks/useMyActiveCoverages';
import { slaInfo, getUrl } from '../../utils/helpers';
import { applySlaExtensionsToRows, isSlaExtensionLocked } from '../../utils/applySlaExtensions';
import {
  scopeOffboardingCases,
  scopeWorkbenchTasks,
  scopeOnboardingPeople,
  scopePausedOnboarding,
  scopeAmendmentRequests,
  scopeRedlineRequests,
  scopeIncentivePlans,
  scopeImmigrationTasks,
  scopeImmigrationCases,
  scopeHiddenTasks,
  filterByAssignee as scopeTicketsByAssignee,
  getVisibleEmails,
  isAdminUser,
} from '../../lib/queue-scoping';
import { ToolBadge, StatusBadge, SlaBadge } from '../ui/Badges';
import { PermissionsContext, SettingsContext, IntegrationsContext } from '../../App';
import Avatar from '../ui/Avatar';
import { useQueueSlaSettings } from '../../hooks/useQueueSlaSettings';
import { useTaskNotes } from '../../hooks/useTaskNotes';
import { useTeamDataVersion } from '../../hooks/useTeamDataVersion';
import { useCurrentDept } from '../../hooks/useCurrentDept';
import { isDeptSourceVisible } from '../../lib/dept-source-visibility';
import { getHubBrand } from '../../lib/hub-brand';
import { useHideResolved } from '../../hooks/useHideResolved';
import {
  SUBJECT_WIDTH_MIN,
  clampSubjectWidth as clampSubjectWidthShared,
  loadStoredSubjectWidth,
  saveStoredSubjectWidth,
} from '../../lib/queue-subject-width';
import UnifiedSyncButton from './UnifiedSyncButton';
import SourceTable from './SourceTable';
import ImmigrationCasesTable from './ImmigrationCasesTable';
import ErrorBoundary from '../ui/ErrorBoundary';
import CoverageBanner from '../ooo/CoverageBanner';
import {
  normalizeOnboarding,
  normalizeOffboarding,
  normalizeAmendments,
  normalizeRedlines,
  normalizeWorkbench,
  normalizePausedOnboarding,
  normalizeIncentivePlans,
  normalizeImmigrationTasks,
} from '../../utils/normalizeSourceRows';
import { isUrgentAssistTaskType } from '../../lib/urgent-assist-task-types';
import CreateHideTaskRequestModal from '../modals/CreateHideTaskRequestModal';
import CreateSlaExtensionModal from '../modals/CreateSlaExtensionModal';
import ReassignTaskModal from '../modals/ReassignTaskModal';
import CreateHrHubRequestModal from '../modals/CreateHrHubRequestModal';
import HiddenTasksPanel from './HiddenTasksPanel';
import TasksQueuePanel from './TasksQueuePanel';
import WorkspaceHome from './WorkspaceHome';

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

// Canonicalize ISO-2 country codes so display-name dupes merge into a
// single dropdown option and the filter matches both code variants.
// 2026-05-25 — Pablo Gonzalez (GIX) reported the country filter "does
// not apply" for some queues. Two distinct root causes overlapped:
//   1. `applyQueueFilter` (Jira/Zendesk tab counts) skipped fCountry —
//      see comment further down where it's now applied.
//   2. The dropdown showed "United Kingdom" twice (one row for 'GB',
//      one for 'UK') because some sources tag rows with the canonical
//      ISO-2 code 'GB' (Zendesk Destination Country custom field) and
//      others with 'UK' (Jira keyword-scan via detectCountry's
//      COUNTRY_KEYWORDS map). Selecting one variant leaked the other
//      out of the filter. Canonicalizing 'UK' → 'GB' here unifies
//      both at every comparison site.
const CC_ALIASES = { UK: 'GB' };
const canonicalCC = (cc) => {
  const c = String(cc || '').toUpperCase();
  return CC_ALIASES[c] || c;
};

// ── Work Source Button config ──
const WORK_SOURCES = [
  { id: 'onboarding',     label: 'Onboarding',     icon: 'bi-person-plus-fill',   color: '#7c3aed', bg: '#f3eff8' },
  { id: 'offboarding',    label: 'Offboarding',    icon: 'bi-person-dash-fill',   color: '#d42d35', bg: '#fef2f2' },
  { id: 'amendments',     label: 'Amendments',     icon: 'bi-pencil-square',      color: '#ed8d00', bg: '#fff8e6' },
  { id: 'redlines',       label: 'Redlines',       icon: 'bi-file-earmark-diff',  color: '#7c3aed', bg: '#f3eff8' },
  { id: 'incentive_plans',label: 'Incentive Plans',icon: 'bi-cash-coin',          color: '#0e7490', bg: '#ecfeff' },
  { id: 'workbench',      label: 'Workbench',      icon: 'bi-grid-3x3-gap-fill',  color: '#0369a1', bg: '#eff6ff' },
  { id: 'immigration_tasks', label: 'Immigration Tasks', icon: 'bi-passport-fill',color: '#0369a1', bg: '#e0f2fe' },
  { id: 'immigration_cases', label: 'Immigration Cases', icon: 'bi-folder-fill',  color: '#0c4a6e', bg: '#e0f2fe' },
  { id: 'jira',           label: 'Jira',           icon: 'bi-kanban-fill',        color: '#1f74b3', bg: '#e8f0fe' },
  { id: 'zendesk',        label: 'Zendesk',        icon: 'bi-headset',            color: '#29811e', bg: '#e8f5e9' },
];

// Admin-only synthetic source. Appended at render time when the viewer's
// access === 'admin'. Renders HiddenTasksPanel instead of a SourceTable
// because the data shape (hidden_task rows) is different from queue rows
// — it carries hidden_by, approved_by, reason, etc. that no other panel
// uses. Count + panel rows are role-scoped via `scopeHiddenTasks` so
// every role sees only the hides in their visibility chain (admin still
// sees everything). `hiddenTasks.hiddenKeys` is intentionally NOT
// scoped — hides are universal at the queue-display layer.
const HIDDEN_TAB = { id: 'hidden', label: 'Hidden', icon: 'bi-eye-slash-fill', color: '#d42d35', bg: '#fef2f2' };

// Phase 2 (2026-05-25): synthetic "Tasks" source rendered ahead of the
// admin-only Hidden tab. Backed by the work_tasks API rather than the
// unified queue sync; data + behaviours live in TasksQueuePanel which
// reuses the same composer + drawer the standalone Tasks tab uses.
const WORK_TASKS_TAB = { id: 'work_tasks', label: 'Tasks', icon: 'bi-check2-square', color: '#7c3aed', bg: '#f3eff8' };

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

// ── Subject column width (user-resizable) ───────────────────────────────────
// Carolina Ferreira 2026-05-20 bug "Jira queue" / "Under the Jira queue we
// cannot see the full ticket title, and therefore we don't know to which
// employee it is referring to." Chaitanya Raju Uppalapati 2026-05-22 bug:
// same problem on Workbench's Subject column ("Workbench Title should be
// extendable just like in workbench to be able to see the name of the
// Employee"). The Workbench / Onb / Off / Amend / Redline / IP tables share
// SourceTable, so the same resize affordance applies to all six.
//
// Mechanic: the Subject column header renders a drag handle on its right
// edge. Mousedown starts a drag that mutates the table's
// `--queue-subject-width` CSS variable directly on the DOM (so virtualized
// rows update without a React re-render storm); mouseup syncs React state
// + persists to localStorage so the next mount keeps the user's chosen
// width. Storage / clamp helpers live in `src/lib/queue-subject-width.js`
// so the SourceTable mirror reuses them (skill rule #5 — user-scoped
// cache). Default bumped from the previous effective 320 px to 480 px so
// even users who never resize see ~50% more title.
const SUBJECT_WIDTH_DEFAULT = 480;
const SUBJECT_WIDTH_STORAGE_BASE = 'ops_hub_queue_subject_width';
const clampSubjectWidth = (n) => clampSubjectWidthShared(n, SUBJECT_WIDTH_DEFAULT);

// The WORK_SOURCES tab id → visibleSources key mapping (plus the always-on
// Zendesk/Jira carve-out) now lives in src/lib/dept-source-visibility.js so
// the Queue tab row, the home "By Source" card, and the sync popover share one
// gate and can't drift (mistake #52).

const Queue = ({ user, tasks, subFilter, focusTaskId, onTaskFocused, initialAssignee = null, onInitialAssigneeConsumed }) => {
  // Phase 14.1 (2026-05-20): per-dept Deel-source visibility. Tabs that
  // belong to a source the current dept has explicitly hidden don't render
  // at all (GIX hides 5; HRX keeps all 6). HRX preserves identical
  // behavior because its visibleSources profile sets all 6 → true.
  const deptState = useCurrentDept();
  const visibleSources = deptState?.visibleSources;
  // 2026-05-22 — dept-branded escalation button + banner copy. Defaults
  // to "HR" cold-paint until useCurrentDept resolves the dept (HRX users
  // keep the original wording).
  const hubBrand = useMemo(() => getHubBrand(deptState?.dept), [deptState?.dept]);
  // 2026-05-22 — Celine Taruc's request: persistent "hide resolved" toggle
  // on the queue header. Email-scoped via the hook (different identities
  // on the same browser keep separate preferences).
  const { hideResolved, toggleHideResolved } = useHideResolved(user?.email);

  // Filters always start in their default state to keep SSR HTML identical
  // to the first client render. The `useEffect` below rehydrates from
  // localStorage after mount — prevents React #418 hydration mismatches
  // that fired on every Queue navigation per the launch audit.
  const [fTool, setFTool] = useState(null);
  const [fStatus, setFStatus] = useState([]);
  const [search, setSearch] = useState('');
  const [fSla, setFSla] = useState(null);
  // 2026-05-28 (Pablo Gonzalez ask) — filter Zendesk tickets by which SLA
  // metric they're ticking against. Values mirror the row.slaMetric set
  // populated upstream: 'frt' (first reply time), 'nrt' (next reply time),
  // 'rwt' (requester waiting time — pending customer reply), 'put'
  // (periodic update time — pending agent update), or null = no filter.
  // Jira + Deel sources don't carry slaMetric so they pass through when
  // this filter is active.
  const [fSlaMetric, setFSlaMetric] = useState(null);
  const [fJiraActionable, setFJiraActionable] = useState(true);
  const [fJiraRaised, setFJiraRaised] = useState(false);
  const [fUnassigned, setFUnassigned] = useState(false);
  // Country filter — array of uppercase ISO-2 codes. Multi-select so
  // managers can scope to e.g. {NAM, LATAM} regions in one click. Empty =
  // no filter. Insiya Jasdanwalla 2026-05-15 ask: "Request to filter team
  // queue by country — cannot filter the queue by specific country".
  const [fCountry, setFCountry] = useState([]);
  // Jose Ruales 2026-06-09 (Manager Workload Visibility) — assignee filter,
  // parity with HR Hub. Multi-select array of lowercased emails (mirrors
  // fCountry). Powers the per-agent workload drill-in: a manager clicks a
  // direct report in the Briefing Team Summary and lands here pre-filtered to
  // that person across every queue (see the initialAssignee prop + its consume
  // effect). NOT persisted to localStorage — it's a transient "view this
  // person's queue" action, not a durable preference (mirrors `search`).
  const [fAssignee, setFAssignee] = useState([]);

  // Post-mount filter rehydration — runs once per signed-in identity.
  useEffect(() => {
    const saved = loadFilters(user?.email);
    if (!saved) return;
    if (saved.fTool) setFTool(saved.fTool);
    if (Array.isArray(saved.fStatus)) setFStatus(saved.fStatus);
    else if (saved.fStatus) setFStatus([saved.fStatus]);
    if (saved.fSla) setFSla(saved.fSla);
    if (typeof saved.fSlaMetric === 'string'
      && ['frt', 'nrt', 'rwt', 'put'].includes(saved.fSlaMetric)) {
      setFSlaMetric(saved.fSlaMetric);
    }
    if (typeof saved.fJiraActionable === 'boolean') setFJiraActionable(saved.fJiraActionable);
    if (typeof saved.fJiraRaised === 'boolean') setFJiraRaised(saved.fJiraRaised);
    if (saved.fUnassigned) setFUnassigned(true);
    // Canonicalize on restore so legacy 'UK' saved values normalize to
    // 'GB' and the dropdown's GB-keyed option matches them. Without this,
    // a user whose localStorage holds ['UK'] from before this fix would
    // see "0 rows" on first paint because the new dropdown only emits
    // canonical 'GB'.
    if (Array.isArray(saved.fCountry)) {
      const normalized = [...new Set(saved.fCountry.map(canonicalCC).filter(Boolean))];
      setFCountry(normalized);
    }
  }, [user?.email]);

  // Cross-view filter intent — fires when a Briefing/AgentHome card asks the
  // Queue to land on a specific SLA tier (e.g. "Show breaches"). The Queue
  // applies the requested filter and clears the rest so the user lands on a
  // clean view. The CustomEvent pattern matches the existing
  // `<feature>:openDetail` events dispatched by App.jsx for deep-links.
  useEffect(() => {
    const handler = (e) => {
      const sla = e?.detail?.sla;
      if (sla !== 'breached' && sla !== 'at_risk' && sla !== 'ok' && sla !== null) return;
      setFSla(sla);
      // Clear other filters so the user actually sees what they asked for.
      // Keep the source-tab choice (workSource) untouched — if they asked
      // from inside a source view we honour the context. fSlaMetric also
      // clears so a deep-link "show breaches" doesn't compose with a
      // stale FRT/NRT narrowing the user forgot about.
      setFTool(null);
      setFStatus([]);
      setFSlaMetric(null);
      setFUnassigned(false);
      setFCountry([]);
      setSearch('');
    };
    window.addEventListener('queue:setSlaFilter', handler);
    return () => window.removeEventListener('queue:setSlaFilter', handler);
  }, []);
  const [workSource, setWorkSource] = useState(null);

  // Pablo Gonzalez 2026-05-22 — "Pressing tasks in the daily summary bring
  // me to as blank page". Briefing's ApproachingBreach / MiniTicketList
  // used to call a no-op `setSelTask` + `setView('my-queue')`, so the user
  // landed on Queue's WorkspaceHome with no source filter. On HRX with lots
  // of data the home is busy enough that it doesn't read as broken, but on
  // newer dept tenants (GIX / Payroll / Benefits) with sparse data it looks
  // like a blank page. Briefing now dispatches `queue:focusSource` with
  // `{ source }` after setView, so we land inside the source panel that
  // actually contains the task they clicked.
  useEffect(() => {
    const handler = (e) => {
      const src = e?.detail?.source;
      if (typeof src !== 'string' || !src) return;
      if (src === 'zendesk' || src === 'jira') {
        setWorkSource(null);
        setFTool(src);
        return;
      }
      // Deel source panels — each has its own workSource id. Defensive
      // allowlist (no setWorkSource for unknown ids). 'work_tasks' added
      // 2026-05-25 when Tasks was moved from a top-level tab into this
      // shell, so the bell deep-link / WorkTasksTour final CTA / Home
      // "My Tasks" card all land inside the Tasks queue tab.
      if (src === 'onboarding' || src === 'offboarding' ||
          src === 'amendments' || src === 'redlines' ||
          src === 'workbench' || src === 'incentive_plans' ||
          src === 'immigration_tasks' || src === 'immigration_cases' ||
          src === 'work_tasks' ||
          src === 'hidden') {
        setFTool(null);
        setWorkSource(src);
      }
    };
    window.addEventListener('queue:focusSource', handler);
    return () => window.removeEventListener('queue:focusSource', handler);
  }, []);

  // 2026-05-25 — when a notification deep-link to a work_task arrives,
  // App.jsx flips view to 'my-queue' and sets focusTaskId. Auto-activate
  // the work_tasks source tab so TasksQueuePanel mounts and opens the
  // detail drawer. The id is cleared by TasksQueuePanel via
  // onTaskFocused once consumed so a subsequent tab switch doesn't keep
  // forcing the user back onto Tasks.
  useEffect(() => {
    if (focusTaskId) {
      setFTool(null);
      setWorkSource('work_tasks');
    }
  }, [focusTaskId]);
  // Jose Ruales 2026-06-09 — manager workload drill-in. When a manager clicks a
  // direct report's name in the Briefing Team Summary, App flips the view to
  // 'my-queue' and sets initialAssignee to that agent's email. Consume it on
  // mount: pre-fill the assignee filter to that person, clear every other
  // narrowing filter, and drop to the cross-source landing so the manager sees
  // that agent's FULL workload across all queues. Cleared via
  // onInitialAssigneeConsumed so a later tab switch doesn't re-pin the filter
  // (mirrors the focusTaskId consume pattern above). Views are conditionally
  // mounted, so an App-level intent prop is used rather than a CustomEvent
  // (which would fire before this component mounts and be missed).
  useEffect(() => {
    if (!initialAssignee) return;
    const email = String(initialAssignee).toLowerCase().trim();
    if (email) {
      setFAssignee([email]);
      setFTool(null);
      setWorkSource(null);
      setFStatus([]);
      setFSla(null);
      setFSlaMetric(null);
      setFUnassigned(false);
      setFCountry([]);
      setSearch('');
    }
    onInitialAssigneeConsumed?.();
  }, [initialAssignee]); // eslint-disable-line react-hooks/exhaustive-deps
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

  // ── User-resizable Subject column ────────────────────────────────────────
  // See module-level block at top of file for the bug citation. State holds
  // the React-visible width (drives the table's inline `--queue-subject-
  // width` CSS variable on next render); `subjectWidthRef` carries the
  // in-flight value during a drag so onmousemove can update the DOM
  // directly without going through React. `tableElRef` lets the drag
  // handler reach into the table to set the variable per frame.
  const [subjectWidth, setSubjectWidth] = useState(() => loadStoredSubjectWidth(SUBJECT_WIDTH_STORAGE_BASE, user?.email, SUBJECT_WIDTH_DEFAULT));
  const subjectWidthRef = useRef(subjectWidth);
  useEffect(() => { subjectWidthRef.current = subjectWidth; }, [subjectWidth]);
  const tableElRef = useRef(null);
  // Re-load if the signed-in email changes mid-session (impersonation +
  // login-as-dept-admin flows swap `user` without a remount).
  useEffect(() => {
    const next = loadStoredSubjectWidth(SUBJECT_WIDTH_STORAGE_BASE, user?.email, SUBJECT_WIDTH_DEFAULT);
    setSubjectWidth(next);
  }, [user?.email]);

  const handleSubjectResizeStart = useCallback((e) => {
    // Don't trigger the header's sort click; don't let the th's mousedown
    // bubble up into the document-level outside-click handlers either.
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = subjectWidthRef.current;
    const onMove = (mv) => {
      const next = clampSubjectWidth(startWidth + (mv.clientX - startX));
      subjectWidthRef.current = next;
      if (tableElRef.current) {
        tableElRef.current.style.setProperty('--queue-subject-width', `${next}px`);
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      const final = subjectWidthRef.current;
      setSubjectWidth(final);
      saveStoredSubjectWidth(SUBJECT_WIDTH_STORAGE_BASE, user?.email, final);
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [user?.email]);

  const perms = useContext(PermissionsContext);
  const settings = useContext(SettingsContext);
  const { queueSync, queueUnified, hiddenTasks, slaExtensions } = useContext(IntegrationsContext);
  // Personal notes attached to any queue row — user-scoped localStorage,
  // keyed by `${source}:${id}` so notes re-attach after every sync.
  const taskNotes = useTaskNotes(user?.email);
  // Modal state for editing a Zendesk/Jira ticket note — SourceTable rows
  // handle their own modal internally; this covers the QueueRow path.
  const [noteModalTask, setNoteModalTask] = useState(null);
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
  // SLA Extension modal state — opens from the row's "SLA Extension"
  // action in any of the 8 sources (tickets + 6 Deel sources). The modal
  // collects duration, reason, ack, then POSTs to /hr-hub/requests with
  // flow='sla_extension_request'. See SLA_EXTENSIONS_PLAN.md.
  const [slaExtensionModalTask, setSlaExtensionModalTask] = useState(null);
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
  // Bulk SLA-extension modal (Ayushi 2026-06-04). Reuses CreateSlaExtensionModal
  // in `tasks` mode; bulk caps the hold at 1–2 days (all auto-approve) and
  // fires one request per selected task.
  const [bulkSlaExtensionTasks, setBulkSlaExtensionTasks] = useState(null);
  // Build a uniform task descriptor from a normalized SourceTable row, so
  // the bulk modal sees the same shape the per-row modal has always seen.
  // `slaLocked` lets the bulk SLA modal pre-skip rows that already carry an
  // active/pending extension (the server would 409 them anyway).
  const buildTaskDescriptor = useCallback((row, sourceKey) => ({
    source: sourceKey,
    id: String(row.id),
    url: row.taskUrl || null,
    subject: row.subject,
    country: row.country,
    assigneeEmail: row.assigneeEmail || null,
    assigneeName: row.assignee || null,
    hasOverride: !!row.reassignedFromEmail,
    slaLocked: isSlaExtensionLocked(row),
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
    immigrationTasksData = { tasks: [] },
    immigrationCasesData = { cases: [] },
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
  // 2026-05-28 — pass deptSlug so normalizeWorkbench can swap the 48h
  // HRX default for the 60-day GIX default. Other depts continue to
  // fall through to the global queue_sla_thresholds config.
  const workbenchRowsAll        = useMemo(() => normalizeWorkbench(workbenchTasksFiltered, queueSla, { deptSlug: deptState?.dept?.slug }).filter(r => !isHiddenKey('workbench', r.id)), [workbenchTasksFiltered, queueSla, isHiddenKey, deptState?.dept?.slug]);
  const incentivePlanRowsAll    = useMemo(() => normalizeIncentivePlans(incentivePlansData.items, queueSla).filter(r => !isHiddenKey('incentive_plans', r.id)), [incentivePlansData.items, queueSla, isHiddenKey]);
  // 2026-05-22: GIX-only Immigration Tasks rows. `normalizeImmigrationTasks`
  // already derives per-row SLA from (dueDate - createdAt), so the
  // queueSla flat policy is intentionally NOT passed — each task carries
  // its own deadline.
  // 2026-05-22 — Immigration Tasks rows arrive PRE-NORMALISED from
  // /api/v1/integrations/deel/immigration-tasks (the route calls
  // normalizeImmigrationTasks server-side before scoping by assigneeEmail).
  // Re-running the normaliser here was destroying every field that came
  // from a nested object (caseData / assignee) because the second pass
  // would read `t.caseData?.applicant?.name` on a row that no longer has
  // caseData, falling back to '' for subject / country / assignee /
  // taskUrl. Symptom: all 300 GIX rows rendered "Immigration Task" +
  // "--" + "Unassigned" + no Open link. Fix is to use the rows as-is.
  const immigrationTaskRowsAll  = useMemo(() => (immigrationTasksData.tasks || []).filter(r => !isHiddenKey('immigration_tasks', r.id)), [immigrationTasksData.tasks, isHiddenKey]);
  // 2026-06-03: GIX-only Immigration Cases rows. Arrive PRE-NORMALISED from
  // /api/v1/integrations/deel/immigration-cases (the route runs
  // normalizeImmigrationCases server-side, then scopes by the case's active
  // agent email), so they're used as-is — same contract as Immigration Tasks.
  const immigrationCaseRowsAll  = useMemo(() => (immigrationCasesData.cases || []), [immigrationCasesData.cases]);

  const isAdmin = isAdminUser(user);
  const isLead = perms?.dataScope === 'team_tasks';
  // Agents see country-OR-assignee unions on Redlines / Amendments / Onb /
  // Off / Incentive Plans (their `visibleEmails` is just self, but their
  // `visibleCountries` pulls in team members' rows). Trish Lee 2026-05-11
  // feedback: the SLA header pills tallied that whole union, so an agent
  // with 2 personal breaches but 3 teammate breaches in her countries saw
  // "5 Breached" — misleading. The pills should reflect HER queue, not the
  // team's. Managers (TL / RM / Admin) keep the team-wide tally because
  // that's the signal they need to delegate / escalate.
  const isAgent = perms?.dataScope === 'own_tasks_only';
  const myEmailLc = (user?.email || '').toLowerCase();
  const mineOnlyForSla = useCallback((rows) => {
    if (!isAgent || !myEmailLc || !Array.isArray(rows)) return rows;
    return rows.filter(r => (r?.assigneeEmail || '').toLowerCase() === myEmailLc);
  }, [isAgent, myEmailLc]);
  // Reassign is open to every authenticated user (2026-05-07): the
  // server-side role gate on /api/v1/queue/source-reassign and
  // /api/v1/queue/reassign was lifted alongside this — agents need to
  // reassign their own cases without round-tripping through a TL.
  // The directory + active-member checks on the server still prevent
  // parking rows on a ghost / deactivated email.
  const canReassign = !!user;
  // Tickets: attach `slaExtension` to ZD/Jira rows so `slaInfo()` reads
  // the override at the very top of its decision tree (helpers.js). The
  // override map is keyed (source, id) — same key Queue.jsx uses for the
  // hidden-task filter — so applying it inline here keeps the override
  // out of the tickets' `tasks` state at the App.jsx level (which is
  // shared with other surfaces that don't care about SLA).
  const _slaExtMapForTickets = slaExtensions?.map || null;
  const ns = (tasks || [])
    .filter(t => t.source !== 'slack' && t.source !== 'calendar' && !isHiddenKey(t.source, t.id))
    .map(t => {
      if (!_slaExtMapForTickets) return t;
      const ext = _slaExtMapForTickets.get(`${t.source}:${String(t.id)}`);
      if (!ext || !ext.expiresAt) return t;
      const expiresMs = Date.parse(ext.expiresAt);
      if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) return t;
      return { ...t, slaExtension: ext };
    });

  // ── Active OOO coverage subtree (2026-06-02 — Belu feedback) ────────────
  // When the viewer is covering a peer manager, the server-side queue
  // routes already widen via queue-scoping._coverageEmailsForRequester,
  // but the FE re-scope below calls getVisibleEmails (which on the client
  // has an empty delegation cache) and re-narrows back to the natural
  // subtree. Compute the covered subtree once here so the Jira
  // Actionable/Raised filters AND every Deel-source scope call agree on
  // who's in scope. Tickets already get this treatment via App.jsx's
  // perms.scopeTasks(tasks, MEMBERS, coverageEmails).
  const {
    membersByEmail: queueLiveMembersByEmail,
    getDirectReports: queueLiveGetDirectReports,
    getAllReports: queueLiveGetAllReports,
  } = useTeamMembers();
  const { items: queueActiveCoverages } = useMyActiveCoverages();
  const queueCoverageScope = useMemo(() => expandCoverageScope(queueActiveCoverages, {
    membersByEmail: queueLiveMembersByEmail,
    getDirectReports: queueLiveGetDirectReports,
    getAllReports: queueLiveGetAllReports,
  }), [queueActiveCoverages, queueLiveMembersByEmail, queueLiveGetDirectReports, queueLiveGetAllReports]);
  const queueCoverageEmails = queueCoverageScope.emails;

  // Emails the current viewer "owns" — their email + every teammate below
  // them in the hierarchy (used to classify each Jira ticket as Actionable
  // vs Raised by You for the filter chips and counts). Threads coverage
  // through `extraEmails` so a covered TL's reports' Jira tickets count
  // as Actionable for the coverer.
  const visibleEmails = useMemo(() => getVisibleEmails(user, queueCoverageEmails), [user, queueCoverageEmails]);

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
  // After scoping, each row set is run through `applySlaExtensionsToRows`
  // so any row carrying an approved + active sla_extension gets its
  // `slaRemaining`/`slaBreachStatus`/`slaWindowMs` rewritten to the
  // extended timer (Phase 3 — SLA_EXTENSIONS_PLAN.md). Downstream
  // consumers (rowSlaSeverity, slaTier, BriefingView aggregates) read
  // the overridden fields naturally — no per-consumer code change.
  const slaExtensionMap = slaExtensions?.map || null;
  // 2026-05-22 — pending sla_extension_request map drives the row-level
  // "extension requested" badge + locks the SLA Extension action so users
  // don't keep re-clicking (Madeleine Solares Decuir feedback).
  const slaExtensionPendingMap = slaExtensions?.pendingMap || null;
  // Bumps when the roster or country-ownership map mutates (Team-tab edit
  // in this session OR another user's session pulling fresh data via the
  // visibility/focus/poll refetch). Threaded into every scope memo so
  // client-side scoping re-derives on the same tick — Insiya + Mohamed
  // 2026-05-18 ("the new manager still sees the old team Qs / the old
  // team member still sees old countries that have been removed from
  // them"). scope* helpers read OWNER_COUNTRIES + the live roster via
  // live bindings, so the value itself doesn't go INTO the memo body —
  // it only triggers re-derive.
  const teamDataVersion = useTeamDataVersion();
  const onboardingActionRowsScoped = useMemo(() => scopeOnboardingPeople(onboardingRowsAll, user, queueCoverageEmails), [onboardingRowsAll, user, teamDataVersion, queueCoverageEmails]);
  const pausedOnboardingRowsScoped = useMemo(() => scopePausedOnboarding(pausedOnboardingRowsAll, user, queueCoverageEmails), [pausedOnboardingRowsAll, user, teamDataVersion, queueCoverageEmails]);
  const onboardingActionRows = useMemo(() => applySlaExtensionsToRows(onboardingActionRowsScoped, slaExtensionMap, 'onboarding', slaExtensionPendingMap), [onboardingActionRowsScoped, slaExtensionMap, slaExtensionPendingMap]);
  const pausedOnboardingRows = useMemo(() => applySlaExtensionsToRows(pausedOnboardingRowsScoped, slaExtensionMap, 'onboarding', slaExtensionPendingMap), [pausedOnboardingRowsScoped, slaExtensionMap, slaExtensionPendingMap]);
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
  const offboardingRows = useMemo(() => applySlaExtensionsToRows(scopeOffboardingCases(offboardingRowsAll, user, queueCoverageEmails), slaExtensionMap, 'offboarding', slaExtensionPendingMap), [offboardingRowsAll, user, slaExtensionMap, slaExtensionPendingMap, teamDataVersion, queueCoverageEmails]);
  const amendmentRows   = useMemo(() => applySlaExtensionsToRows(scopeAmendmentRequests(amendmentRowsAll, user, queueCoverageEmails), slaExtensionMap, 'amendments', slaExtensionPendingMap), [amendmentRowsAll, user, slaExtensionMap, slaExtensionPendingMap, teamDataVersion, queueCoverageEmails]);
  const redlineRows     = useMemo(() => applySlaExtensionsToRows(scopeRedlineRequests(redlineRowsAll, user, queueCoverageEmails), slaExtensionMap, 'redlines', slaExtensionPendingMap), [redlineRowsAll, user, slaExtensionMap, slaExtensionPendingMap, teamDataVersion, queueCoverageEmails]);
  const workbenchRows   = useMemo(() => applySlaExtensionsToRows(scopeWorkbenchTasks(workbenchRowsAll, user, queueCoverageEmails), slaExtensionMap, 'workbench', slaExtensionPendingMap), [workbenchRowsAll, user, slaExtensionMap, slaExtensionPendingMap, teamDataVersion, queueCoverageEmails]);
  const incentivePlanRows = useMemo(() => applySlaExtensionsToRows(scopeIncentivePlans(incentivePlanRowsAll, user, queueCoverageEmails), slaExtensionMap, 'incentive_plans', slaExtensionPendingMap), [incentivePlanRowsAll, user, slaExtensionMap, slaExtensionPendingMap, teamDataVersion, queueCoverageEmails]);
  // Immigration tasks share the standard SLA-extension keyed map (source +
  // id), so a future per-row SLA-extension request flow can apply here
  // identically to the other Deel sources.
  const immigrationTaskRows = useMemo(() => applySlaExtensionsToRows(scopeImmigrationTasks(immigrationTaskRowsAll, user, queueCoverageEmails), slaExtensionMap, 'immigration_tasks', slaExtensionPendingMap), [immigrationTaskRowsAll, user, slaExtensionMap, slaExtensionPendingMap, teamDataVersion, queueCoverageEmails]);
  // Immigration Cases are read-only (no hide / SLA-extension flow), so just
  // role-scope by the case's active-agent email — same matrix as the others.
  const immigrationCaseRows = useMemo(() => scopeImmigrationCases(immigrationCaseRowsAll, user, queueCoverageEmails), [immigrationCaseRowsAll, user, teamDataVersion, queueCoverageEmails]);
  // Workbench is the only Deel source that intentionally surfaces resolved
  // rows (24h of COMPLETED + CLOSED) so the "RESOLVED TODAY" section can
  // render. Strip them from the cross-source "All" aggregates so the
  // top-of-page open/paused counts and the active SLA tally don't double-
  // count finished work alongside actual backlog. SourceTable still gets
  // the full `tblWorkbenchRows` set so it can render its own resolved
  // section directly.
  const workbenchActiveRows = useMemo(() => workbenchRows.filter(r => !r.isResolved), [workbenchRows]);
  // Immigration Tasks normaliser only emits `ONGOING` rows today (upstream
  // already filters by `status[]=ONGOING`), but mirror the workbench
  // pattern in case the upstream ever surfaces COMPLETED in the same
  // pull — keeps the open/paused/resolved partitions consistent across
  // sources.
  const immigrationTaskActiveRows = useMemo(() => immigrationTaskRows.filter(r => !r.isResolved), [immigrationTaskRows]);
  // Immigration Cases are all open/on-hold (never resolved), so active = all;
  // mirror the partition for consistency with the other sources.
  const immigrationCaseActiveRows = useMemo(() => immigrationCaseRows.filter(r => !r.isResolved), [immigrationCaseRows]);
  // Per-role view of the Hidden audit list. `hiddenTasks.items` stays
  // global (so `hiddenKeys` keeps filtering hidden rows out of every
  // queue for everyone — hides are universal), but the Hidden TAB now
  // surfaces a role-scoped slice so an agent sees their own hide
  // requests / approvals, a TL sees the team's, an RM their region,
  // and admin still sees everything.
  const scopedHiddenItems = useMemo(
    () => scopeHiddenTasks(hiddenTasks?.items || [], user),
    [hiddenTasks?.items, user],
  );
  // Shape-stable wrapper so HiddenTasksPanel keeps reading `items` +
  // `refresh` the same way; only the items list is narrowed.
  const scopedHiddenTasks = useMemo(
    () => ({ ...(hiddenTasks || {}), items: scopedHiddenItems }),
    [hiddenTasks, scopedHiddenItems],
  );
  const allSourceRows   = useMemo(() => [
    ...onboardingRows, ...offboardingRows, ...amendmentRows, ...redlineRows, ...workbenchActiveRows, ...incentivePlanRows,
  ], [onboardingRows, offboardingRows, amendmentRows, redlineRows, workbenchActiveRows, incentivePlanRows]);

  // ── Memoized filter chain — only recomputes when inputs change ──
  const { baseVis, visPreSla, active, eorSigning, snoozed, done, all } = useMemo(() => {
    let _vis = scopeTicketsByAssignee(ns, user).filter(passesJiraRoleFilter);
    const _baseVis = _vis.filter(t => !t.isCalendarBooking);
    if (fTool)          _vis = _vis.filter(t => t.source === fTool);
    if (fStatus.length) _vis = _vis.filter(t => fStatus.includes(t.status));
    if (fUnassigned)    _vis = _vis.filter(t => !t.assigneeId && !t.assigneeEmail);
    if (fCountry.length) _vis = _vis.filter(t => fCountry.includes(canonicalCC(t.country)));
    if (fAssignee.length) _vis = _vis.filter(t => fAssignee.includes((t.assigneeEmail || '').toLowerCase()));
    // 2026-05-28 (Pablo Gonzalez) — Zendesk SLA-metric filter. Applied to
    // Zendesk rows only (Jira + Deel pass through untouched because they
    // don't carry slaMetric). Combines naturally with fSla='breached' so
    // selecting FRT + Breached yields "all FRT breaches" as asked.
    if (fSlaMetric) {
      _vis = _vis.filter(t => t.source !== 'zendesk' || t.slaMetric === fSlaMetric);
    }
    const _visPreSla = _vis.filter(t => !t.isCalendarBooking);
    if (fSla === 'ok')       _vis = _vis.filter(t => { const s = slaInfo(t); return s && s.ok; });
    if (fSla === 'at_risk')  _vis = _vis.filter(t => { const s = slaInfo(t); return s && !s.ok && !s.breach; });
    if (fSla === 'breached') _vis = _vis.filter(t => { const s = slaInfo(t); return s && s.breach; });
    _vis = _vis.filter(t => !t.isCalendarBooking);
    if (search) {
      const sl = search.toLowerCase();
      _vis = _vis.filter(t =>
        t.subject.toLowerCase().includes(sl)
        || t.id.toLowerCase().includes(sl)
        || t.type.toLowerCase().includes(sl)
        || (t.requesterName || '').toLowerCase().includes(sl)
        || (t.requesterEmail || '').toLowerCase().includes(sl)
      );
    }

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
        case 'source':    return (t.source || '').toLowerCase();
        case 'subject':   return (t.subject || '').toLowerCase();
        case 'function':  return (FUNCTIONS[t.type]?.label || t.type || '').toLowerCase();
        case 'country':   return (t.country || '').toLowerCase();
        case 'requester': return (t.requesterName || '').toLowerCase();
        case 'assignee':  return ((resolveAssignee(t).name) || '').toLowerCase();
        case 'received':  return ticketCreatedMs(t);
        case 'status':    return (t.status || '').toLowerCase();
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
    // Carolina Ferreira 2026-05-26 — Jira tickets in an "EOR signing"
    // workflow state currently render in the main Active section because
    // JIRA_STATUS_MAP['eor signing'] = 'in_progress'. That hides the
    // tickets actually needing action behind 30-50 pending-signature rows
    // that no agent can do anything about. Pull them into their own
    // bucket (rendered below Active, above PAUSED + RESOLVED) so the
    // section behaves like RESOLVED TODAY — visible if you scroll, but
    // out of the way of the actionable queue.
    //
    // Match the Jira workflow status name (the raw human-readable label
    // before it normalises to in_progress). Liberal regex so "EOR
    // Signing", "Pending EOR Signature", "Awaiting EOR Signing", etc all
    // route here. Zendesk has no equivalent state, so the source check
    // also guards against accidental ZD matches.
    const _isPendingEorSigning = (t) => (
      t.source === 'jira'
      && typeof t.jiraStatus === 'string'
      && /eor.?sign(ing|ature)?/i.test(t.jiraStatus)
    );
    const _activePool = _vis.filter(t => t.status !== 'resolved' && t.status !== 'waiting');
    const _eorSigning = sortArr(_activePool.filter(_isPendingEorSigning));
    const _sorted = sortArr(_activePool.filter(t => !_isPendingEorSigning(t)));
    // 2026-05-22 — Pablo Gonzalez "you are showing the paused cases first,
    // you need to follow the same sorting as HR department". On HRX the
    // visible top of the queue is active rows (already SLA-tiered), so
    // even when paused rows fell through in fetch order nobody noticed.
    // On GIX the actionable Zendesk tickets land in pending/hold (paused)
    // by default — every row drops into _snoozed, so without a tier sort
    // the worst breaches scattered randomly through the list. Apply the
    // same sortArr to paused rows so Breached → At Risk → On Track is
    // preserved inside the PAUSED section too.
    const _snoozed = sortArr(_vis.filter(t => t.status === 'waiting'));
    const _done = _vis.filter(t => t.status === 'resolved');
    const _all = [..._sorted, ..._eorSigning, ..._snoozed, ..._done];
    return { baseVis: _baseVis, visPreSla: _visPreSla, active: _sorted, eorSigning: _eorSigning, snoozed: _snoozed, done: _done, all: _all };
  }, [ns, user, fTool, fStatus, fUnassigned, fCountry, fAssignee, fSla, fSlaMetric, search, settings.sla_enabled, passesJiraRoleFilter, sortCol, sortDir]);

  const jiraRoleFilterActive = fJiraActionable !== true || fJiraRaised !== false;
  const hasActiveFilters = useMemo(() => !!(fTool || fStatus.length > 0 || fSla || fSlaMetric || fUnassigned || fCountry.length > 0 || fAssignee.length > 0 || search || jiraRoleFilterActive), [fTool, fStatus, fSla, fSlaMetric, fUnassigned, fCountry, fAssignee, search, jiraRoleFilterActive]);
  // Same predicate minus `fSla`. Drives the SLA-pill count branch below so
  // that clicking the On Track / At Risk / Breached pill doesn't itself
  // switch the pill count from the cross-source aggregate (ZD + every Deel
  // source) to the tickets-only count. Jose Ruales 2026-05-20 bug "UI
  // Issue: Inconsistent Breach Count Across Views" — before this guard:
  //   • Default Queue (no filter): pill said "Breached N" where N = ZD +
  //     all-Deel breaches (the cross-source aggregate that also drives
  //     the WorkspaceHome "Clear all breaches" card + the Home banner).
  //   • Click the pill: `hasActiveFilters` flipped TRUE because fSla is
  //     in that list → workspaceHomeSla branch was skipped → fell through
  //     to the `slaBase = visPreSla` (tickets-only, ZD+Jira) branch → the
  //     count collapsed to the ticket-only subset (e.g. 12 of 119), even
  //     though the Deel breaches were still in the queue (now reachable
  //     via the "breached items in other queues" hand-off panel rendered
  //     below the ticket table).
  // The pill's COUNT is a scope indicator ("how many breaches exist in my
  // current view"); clicking it applies the filter but should not change
  // the scope being counted. Other non-SLA filters legitimately narrow
  // the scope (e.g. fTool='jira' narrows to Jira) — those still flip the
  // count via `hasActiveFilters` below.
  const hasNonSlaActiveFilters = useMemo(() => !!(fTool || fStatus.length > 0 || fUnassigned || fCountry.length > 0 || fAssignee.length > 0 || search || jiraRoleFilterActive), [fTool, fStatus, fUnassigned, fCountry, fAssignee, search, jiraRoleFilterActive]);

  // ── Source-panel filter (status severity + unassigned) ──
  // SLA filter is applied SEPARATELY (below) so the SLA pill counts stay
  // total — clicking the "At Risk" pill should narrow the table without
  // collapsing the pill counts to "0 / N / 0".
  const applyPanelFilter = useCallback((rows) => {
    let r = Array.isArray(rows) ? rows : [];
    if (fStatus.length) r = r.filter(row => fStatus.includes(row?.status?.severity));
    if (fUnassigned)    r = r.filter(row => !row?.assigneeEmail);
    if (fCountry.length) r = r.filter(row => fCountry.includes(canonicalCC(row?.country)));
    if (fAssignee.length) r = r.filter(row => fAssignee.includes((row?.assigneeEmail || '').toLowerCase()));
    return r;
  }, [fStatus, fUnassigned, fCountry, fAssignee]);

  // Pre-computed post-status/unassigned row sets. Drive the SLA pill counts.
  const visOnboardingRows  = useMemo(() => applyPanelFilter(onboardingRows),  [onboardingRows, applyPanelFilter]);
  const visOffboardingRows = useMemo(() => applyPanelFilter(offboardingRows), [offboardingRows, applyPanelFilter]);
  const visAmendmentRows   = useMemo(() => applyPanelFilter(amendmentRows),   [amendmentRows, applyPanelFilter]);
  const visRedlineRows     = useMemo(() => applyPanelFilter(redlineRows),     [redlineRows, applyPanelFilter]);
  const visWorkbenchRows   = useMemo(() => applyPanelFilter(workbenchRows),   [workbenchRows, applyPanelFilter]);
  const visIncentivePlanRows = useMemo(() => applyPanelFilter(incentivePlanRows), [incentivePlanRows, applyPanelFilter]);
  const visImmigrationTaskRows = useMemo(() => applyPanelFilter(immigrationTaskRows), [immigrationTaskRows, applyPanelFilter]);
  const visImmigrationCaseRows = useMemo(() => applyPanelFilter(immigrationCaseRows), [immigrationCaseRows, applyPanelFilter]);

  // Per-source SLA severity classifier. At-risk = "less than 25% of the SLA
  // window remaining" — proportional to whatever active/paused window the
  // row is ticking against, so the band scales naturally when the Team-tab
  // SLA settings change. `slaWindowMs` is populated by normalizeSourceRows
  // for every Deel row; if it's missing for any reason we fall back to a
  // 6-hour static threshold (legacy behavior) so a sparse upstream payload
  // never silently turns at-risk classification off.
  const rowSlaSeverity = useCallback((row) => {
    if (!row) return 'ok';
    // Resolved rows don't tick against the SLA bands — once a task is
    // closed the SLA evaluation is final and the row sits under the
    // "RESOLVED TODAY" section, not the active backlog. Returning 'ok'
    // here keeps the SLA pill filter consistent with the pill counts
    // (which already exclude resolved) so clicking "Breached N" never
    // surfaces a finished-and-was-breached row from the resolved tail.
    if (row.isResolved) return 'ok';
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
  const tblImmigrationTaskRows = useMemo(() => applySlaFilter(visImmigrationTaskRows), [visImmigrationTaskRows, applySlaFilter]);
  const tblImmigrationCaseRows = useMemo(() => applySlaFilter(visImmigrationCaseRows), [visImmigrationCaseRows, applySlaFilter]);

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

  // Workspace-home aggregate — pills + the "Clear all breaches" card on
  // WorkspaceHome MUST agree. Before 2026-05-14 the pill counted ZD+Jira
  // tickets only (post mineOnlyForSla) while the card counted ZD-only
  // tickets + every Deel source — Aline reported the "always different"
  // mismatch in feedback 2026-05-13. Single source of truth: ZD-only
  // ticket breaches (Jira excluded per Mohamed's 2026-05-01 home rule)
  // plus all Deel-source breaches, with mineOnlyForSla applied to both
  // so agents see a narrowed "their own queue" view on home consistent
  // with Trish Lee's 2026-05-11 per-source pill feedback. Managers
  // (TL/RM/Admin) see the same team aggregate in both places because
  // mineOnlyForSla is a no-op for them. The result is passed down to
  // WorkspaceHome so the card reads the same number.
  const workspaceHomeSla = useMemo(() => {
    // 2026-05-19: pending+hold Zendesk tickets now carry rwt/put SLA
    // anchors (Track B). Including them here so the workspace-home
    // SLA card aggregates active + paused Zendesk into one number,
    // matching the user's "bring in their SLA as well" ask. `slaInfo`
    // still returns null for resolved Zendesk rows so the filter only
    // drops resolved.
    const tickets = mineOnlyForSla(
      visPreSla.filter(t => t.source === 'zendesk' && t.status !== 'resolved'),
    );
    let atRisk = 0, breached = 0, onTrack = 0;
    for (const t of tickets) {
      const s = slaInfo(t);
      if (!s) { onTrack++; continue; }
      if (s.breach) breached++;
      else if (!s.ok) atRisk++;
      else onTrack++;
    }
    const deel = tallyDeelSla(mineOnlyForSla(allSourceRows));
    return {
      atRiskCount: atRisk + deel.atRiskCount,
      breachedCount: breached + deel.breachedCount,
      onTrackCount: onTrack + deel.onTrackCount,
    };
  }, [visPreSla, allSourceRows, mineOnlyForSla, tallyDeelSla]);

  // ── SLA pills counts — reflect post-filter row sets per active tab ──
  // Agents get a mine-only tally (see `mineOnlyForSla` above) so the pills
  // reflect THEIR queue, not the team's. Managers keep the team-wide count.
  const { atRiskCount, breachedCount, onTrackCount } = useMemo(() => {
    // Workspace-home state (no source + no tool + no NON-SLA filter) uses
    // the aggregated count above so the pills and the "Clear all breaches"
    // card on WorkspaceHome show the same number. `hasNonSlaActiveFilters`
    // (not `hasActiveFilters`) so that toggling the SLA pill itself doesn't
    // collapse the count from cross-source (ZD + all Deel) to tickets-only
    // — see the comment on `hasNonSlaActiveFilters` for Jose's 2026-05-20
    // repro.
    if (!workSource && !fTool && !hasNonSlaActiveFilters) return workspaceHomeSla;
    if (workSource === 'onboarding')      return tallyDeelSla(mineOnlyForSla(visOnboardingRows));
    if (workSource === 'offboarding')     return tallyDeelSla(mineOnlyForSla(visOffboardingRows));
    if (workSource === 'amendments')      return tallyDeelSla(mineOnlyForSla(visAmendmentRows));
    if (workSource === 'redlines')        return tallyDeelSla(mineOnlyForSla(visRedlineRows));
    // Workbench: pills are an active-state band. Strip resolved (24h
    // COMPLETED + CLOSED) before tallying so today's finished tasks
    // don't keep ticking against the SLA bands.
    if (workSource === 'workbench')       return tallyDeelSla(mineOnlyForSla(visWorkbenchRows.filter(r => !r.isResolved)));
    if (workSource === 'incentive_plans') return tallyDeelSla(mineOnlyForSla(visIncentivePlanRows));
    if (workSource === 'immigration_tasks') return tallyDeelSla(mineOnlyForSla(visImmigrationTaskRows.filter(r => !r.isResolved)));
    if (workSource === 'immigration_cases') return tallyDeelSla(mineOnlyForSla(visImmigrationCaseRows.filter(r => !r.isResolved)));
    // Admin Hidden tab — no SLA semantics. Pills sit at zero so they don't
    // borrow numbers from the underlying ZD/Jira queue.
    if (workSource === 'hidden') return { atRiskCount: 0, breachedCount: 0, onTrackCount: 0 };
    if (workSource === 'work_tasks') return { atRiskCount: 0, breachedCount: 0, onTrackCount: 0 };
    let slaBase;
    if (workSource === 'jira') slaBase = visPreSla.filter(t => t.source === 'jira');
    else if (workSource === 'zendesk') slaBase = visPreSla.filter(t => t.source === 'zendesk');
    else slaBase = visPreSla;
    // Drop resolved unconditionally. Drop waiting only for non-Zendesk
    // sources (Jira/Deel have separate pause semantics, no per-source pill).
    // Zendesk waiting (pending/hold) keeps its rwt/put SLA pill (Track B).
    slaBase = mineOnlyForSla(slaBase.filter(t => t.status !== 'resolved' && (t.source === 'zendesk' || t.status !== 'waiting')));
    const atRisk = slaBase.filter(t => { const s = slaInfo(t); return s && !s.ok && !s.breach; }).length;
    const breached = slaBase.filter(t => { const s = slaInfo(t); return s && s.breach; }).length;
    return { atRiskCount: atRisk, breachedCount: breached, onTrackCount: slaBase.length - atRisk - breached };
  }, [workSource, fTool, hasNonSlaActiveFilters, workspaceHomeSla, visPreSla, visOnboardingRows, visOffboardingRows, visAmendmentRows, visRedlineRows, visWorkbenchRows, visIncentivePlanRows, visImmigrationTaskRows, visImmigrationCaseRows, tallyDeelSla, mineOnlyForSla]);

  // Trish Lee 2026-05-28 — "the numbers aren't adding up": for Workbench
  // the tab badge said 9 but the SLA pills summed to 5; for Jira the
  // badge said 49 while the pills summed to 10. The gap has two distinct
  // causes today and neither is visible to the user:
  //   1. Tickets (Jira/Zendesk): pills' `slaBase` excludes paused rows
  //      (status='waiting') by design — 2026-05-21 audit F24 documented
  //      this and promised an inline "(excludes paused)" caption that
  //      never landed.
  //   2. Deel sources (Workbench/Onboarding/etc.) for AGENT users:
  //      `mineOnlyForSla` narrows the pill base to rows assigned to the
  //      agent (2026-05-11 fix — Trish reported teammate breaches showing
  //      in her tier counts). The tab badge keeps the country-OR-assignee
  //      union so it stays useful for "what's in my visibility scope".
  // Surface the residual as a muted `+N other` indicator alongside the
  // three SLA pills so the math reconciles at a glance. The tooltip
  // explains both reasons. Workspace-home (no workSource / no fTool)
  // returns 0 because the pills there are an aggregate that mixes
  // ticket-paused-exclusion with Deel-source-paused-inclusion — too
  // ambiguous to label cleanly. The user there can drill into a tab to
  // see the per-source residual.
  const slaOther = useMemo(() => {
    const pillSum = onTrackCount + atRiskCount + breachedCount;
    let expected;
    if (workSource === 'onboarding')              expected = visOnboardingRows.length;
    else if (workSource === 'offboarding')        expected = visOffboardingRows.length;
    else if (workSource === 'amendments')         expected = visAmendmentRows.length;
    else if (workSource === 'redlines')           expected = visRedlineRows.length;
    else if (workSource === 'workbench')          expected = visWorkbenchRows.filter(r => !r.isResolved).length;
    else if (workSource === 'incentive_plans')    expected = visIncentivePlanRows.length;
    else if (workSource === 'immigration_tasks')  expected = visImmigrationTaskRows.filter(r => !r.isResolved).length;
    else if (workSource === 'immigration_cases')  expected = visImmigrationCaseRows.filter(r => !r.isResolved).length;
    else if (workSource === 'hidden' || workSource === 'work_tasks') return 0;
    else if (fTool === 'jira')                    expected = baseVis.filter(t => t.source === 'jira' && t.status !== 'resolved').length;
    else if (fTool === 'zendesk')                 expected = baseVis.filter(t => t.source === 'zendesk' && t.status !== 'resolved').length;
    else return 0;
    return Math.max(0, expected - pillSum);
  }, [onTrackCount, atRiskCount, breachedCount, workSource, fTool, visOnboardingRows, visOffboardingRows, visAmendmentRows, visRedlineRows, visWorkbenchRows, visIncentivePlanRows, visImmigrationTaskRows, visImmigrationCaseRows, baseVis]);

  // ── View-aware header counts ──
  // For each Deel source we read the SLA-filtered row set so the "N open"
  // badge tracks what the user actually sees in the table, and the existing
  // `hiddenByFilters` indicator can show how many rows the SLA pill hid.
  const headerCounts = useMemo(() => {
    if (workSource === 'onboarding')      return { open: tblOnboardingRows.length,    paused: 0, resolved: 0 };
    if (workSource === 'offboarding')     return { open: tblOffboardingRows.length,   paused: 0, resolved: 0 };
    if (workSource === 'amendments')      return { open: tblAmendmentRows.length,     paused: 0, resolved: 0 };
    if (workSource === 'redlines')        return { open: tblRedlineRows.length,       paused: 0, resolved: 0 };
    if (workSource === 'workbench') {
      // Workbench is the only Deel source that surfaces resolved rows in
      // the queue. Split active / paused / resolved so the header reads
      // "N open · M paused · K resolved" instead of bundling everything
      // under "open".
      let wbOpen = 0, wbPaused = 0, wbResolved = 0;
      for (const r of tblWorkbenchRows) {
        if (r.isResolved) wbResolved++;
        else if (r.isPaused) wbPaused++;
        else wbOpen++;
      }
      return { open: wbOpen, paused: wbPaused, resolved: wbResolved };
    }
    if (workSource === 'incentive_plans') return { open: tblIncentivePlanRows.length, paused: 0, resolved: 0 };
    if (workSource === 'immigration_tasks') return { open: tblImmigrationTaskRows.length, paused: 0, resolved: 0 };
    // Immigration Cases split OPEN vs ON_HOLD so the header reads
    // "N open · M on hold" (isPaused === ON_HOLD per normalizeImmigrationCases).
    if (workSource === 'immigration_cases') return { open: tblImmigrationCaseRows.filter(r => !r.isPaused).length, paused: tblImmigrationCaseRows.filter(r => r.isPaused).length, resolved: 0 };
    if (workSource === 'hidden') return { open: scopedHiddenItems.length, paused: 0, resolved: 0 };
    // Work-tasks live in their own backend; the panel does its own counting.
    if (workSource === 'work_tasks') return { open: 0, paused: 0, resolved: 0 };
    const sourceOpen = fTool ? 0 : (
      tblOnboardingRows.length + tblOffboardingRows.length + tblAmendmentRows.length
      + tblRedlineRows.length + tblWorkbenchRows.length + tblIncentivePlanRows.length
      + tblImmigrationTaskRows.length
    );
    return {
      // EOR-signing tickets are visually separated below but they're
      // still "open" (status=in_progress, not resolved/waiting) so they
      // continue to count toward the header's open total — otherwise
      // `hiddenByFilters` (rawCounts.open - headerCounts.open) would
      // double-count them as filtered-out.
      open: active.length + eorSigning.length + sourceOpen,
      paused: snoozed.length,
      resolved: done.length,
    };
  }, [workSource, fTool, active, eorSigning, snoozed, done, tblOnboardingRows, tblOffboardingRows, tblAmendmentRows, tblRedlineRows, tblWorkbenchRows, tblIncentivePlanRows, tblImmigrationTaskRows, tblImmigrationCaseRows, scopedHiddenItems]);

  const rawCounts = useMemo(() => {
    if (workSource === 'onboarding')      return { open: onboardingRows.length };
    if (workSource === 'offboarding')     return { open: offboardingRows.length };
    if (workSource === 'amendments')      return { open: amendmentRows.length };
    if (workSource === 'redlines')        return { open: redlineRows.length };
    if (workSource === 'workbench')       return { open: workbenchActiveRows.length };
    if (workSource === 'incentive_plans') return { open: incentivePlanRows.length };
    if (workSource === 'immigration_tasks') return { open: immigrationTaskActiveRows.length };
    if (workSource === 'immigration_cases') return { open: immigrationCaseActiveRows.length };
    if (workSource === 'hidden') return { open: scopedHiddenItems.length };
    if (workSource === 'work_tasks') return { open: 0 };
    const base = fTool ? baseVis.filter(t => t.source === fTool) : baseVis;
    const srcExtra = fTool ? 0 : allSourceRows.length;
    return {
      open: base.filter(t => t.status !== 'resolved' && t.status !== 'waiting').length + srcExtra,
    };
  }, [workSource, fTool, baseVis, allSourceRows, onboardingRows, offboardingRows, amendmentRows, redlineRows, workbenchRows, incentivePlanRows, immigrationTaskActiveRows, immigrationCaseActiveRows, scopedHiddenItems]);
  const hiddenByFilters = Math.max(0, rawCounts.open - headerCounts.open);

  // Persist filters to localStorage — user-scoped so two people on the
  // same browser keep their own filter state.
  useEffect(() => {
    try {
      localStorage.setItem(
        queueFiltersKey(user?.email),
        JSON.stringify({ fTool, fStatus, fSla, fSlaMetric, fUnassigned, fCountry, fJiraActionable, fJiraRaised }),
      );
    } catch {}
  }, [user?.email, fTool, fStatus, fSla, fSlaMetric, fUnassigned, fCountry, fJiraActionable, fJiraRaised]);

  // Flatten Active → SNOOZED header → snoozed → DONE header → done into
  // one virtual list. Each item carries `kind: 'row' | 'header'`; both
  // render at TICKET_ROW_HEIGHT so the windowing math is uniform. With
  // Jira at 3,046 active rows, this drops the rendered DOM from ~27k
  // nodes to ~270 — repaint becomes O(viewport), not O(rows).
  const ticketVirtualItems = useMemo(() => {
    const out = active.map(t => ({ kind: 'row', row: t }));
    // Carolina Ferreira 2026-05-26 — Jira "EOR signing" tickets land
    // here. Mirrors RESOLVED TODAY / PAUSED visual treatment: own header
    // band, own count, scrollable below the actionable queue but above
    // the further-removed paused/resolved sections. Blue-ish purple
    // accent so it reads distinct from amber-paused and green-resolved.
    if (eorSigning.length > 0) {
      out.push({ kind: 'header', label: 'PENDING EOR SIGNING', color: '#5b21b6', bg: '#f5f3ff', icon: 'bi-pen', count: eorSigning.length });
      for (const t of eorSigning) out.push({ kind: 'row', row: t });
    }
    if (snoozed.length > 0) {
      out.push({ kind: 'header', label: 'PAUSED', color: '#6b6560', bg: '#faf9f7', icon: 'bi-pause-circle-fill', count: snoozed.length });
      for (const t of snoozed) out.push({ kind: 'row', row: t });
    }
    // 2026-05-22 — `hideResolved` (per-user preference) suppresses the
    // RESOLVED TODAY band entirely. The header counter still surfaces the
    // resolved count via `headerCounts.resolved` so the toggle has visible
    // affordance ("12 resolved" + hidden eye icon).
    if (!hideResolved && done.length > 0) {
      out.push({ kind: 'header', label: 'RESOLVED TODAY', color: '#29811e', bg: '#f9faf8', icon: 'bi-check-circle', count: done.length });
      for (const t of done) out.push({ kind: 'row', row: t });
    }
    return out;
  }, [active, eorSigning, snoozed, done, hideResolved]);
  // Base ticket columns + Actions + Note (always rendered, since Queue
  // owns the notes hook unconditionally).
  const ticketColSpan = (settings.sla_enabled !== false ? 9 : 8) + 2;
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
      {/* ── Phase 3 CoverageBanner — surfaces active OOO coverages so a
          coverer scanning their merged queue knows whose rows are
          appearing alongside their own (HANDOVERS_PLAN.md §10.3). */}
      <div style={{ padding: '8px 24px 0', flexShrink: 0 }}>
        <CoverageBanner />
      </div>
      {/* ── Single Header ── */}
      <div data-role="queue-header" style={{ padding: '8px 32px 12px', background: 'var(--surface)', borderBottom: '1px solid #e8e8e8', flexShrink: 0 }}>
        {/* Line 1: SLA pills (left) · Title/totals · Sync button (right) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          {/* Active state strengthened 2026-05-14 (Carolina Ferreira
              feedback): when the user clicks an SLA pill, the active
              chip flips to a solid filled background with white text +
              a check icon. The "is this filter on?" signal becomes
              unmistakable. Inactive state stays the existing light
              pastel so the row still reads as three semantic statuses.
              Tooltips now explicitly explain what each filter does. */}
          {/* 2026-05-21 audit F24 + Trish Lee 2026-05-28: the three SLA
              tier counts don't always sum to the tab badge / inline "Open"
              total. Two reasons (see the `slaOther` useMemo above):
              ticket-source paused exclusion (F24) and agent mine-only
              narrowing on Deel sources. The trailing "+N other" indicator
              below this triplet surfaces the residual so the math reads
              cleanly at a glance — replaces the never-rendered
              "(excludes paused)" caption F24 originally specified. */}
          <SlaPill
            active={fSla === 'ok'}
            onClick={() => setFSla(fSla === 'ok' ? null : 'ok')}
            tone="ok"
            count={onTrackCount}
            label="On Track"
            hint="Tasks well inside their SLA window — at least 25% of the time budget still remaining."
          />
          <SlaPill
            active={fSla === 'at_risk'}
            onClick={() => setFSla(fSla === 'at_risk' ? null : 'at_risk')}
            tone="atRisk"
            count={atRiskCount}
            label="At Risk"
            hint="Tasks inside SLA but with less than 25% of the time budget left — handle next to avoid a breach."
          />
          <SlaPill
            active={fSla === 'breached'}
            onClick={() => setFSla(fSla === 'breached' ? null : 'breached')}
            tone="breached"
            count={breachedCount}
            label="Breached"
            hint="Tasks past their SLA window — handle these first."
          />
          {/* Trish Lee 2026-05-28 — residual "other" indicator. Surfaces the
              count of rows visible in the active tab/source but excluded
              from the SLA tier classification. The two known reasons:
                • Tickets (Jira/Zendesk): pills exclude paused rows by
                  design (2026-05-21 audit F24).
                • Deel sources for agents: pills are narrowed to the
                  agent's own rows (2026-05-11 fix), the tab badge keeps
                  the country-OR-assignee union.
              Without this, On Track + At Risk + Breached + N = tab badge
              wasn't visible at a glance — Trish's "the numbers aren't
              adding up" feedback. Muted treatment so it reads as
              secondary to the three actionable tier pills. */}
          {slaOther > 0 && (
            <span
              role="note"
              title={(
                'Rows in the active view but excluded from the SLA tier counts. '
                + 'For Jira/Zendesk tabs this is paused tickets (status = waiting); '
                + 'for agents on Deel-source tabs this also covers rows visible in your country that are assigned to teammates. '
                + 'These appear in the table below but don\'t count toward On Track / At Risk / Breached.'
              )}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 12px', borderRadius: 128,
                background: 'var(--surface-3)', border: '1px solid var(--border)',
                color: 'var(--text-muted)', fontSize: 11, fontWeight: 600,
                cursor: 'help', flexShrink: 0,
              }}
            >
              <i className="bi-three-dots" style={{ fontSize: 12 }} aria-hidden="true" />
              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, fontWeight: 700 }}>+{slaOther}</span>
              <span>other</span>
            </span>
          )}
          {fSla && (
            <button
              type="button"
              onClick={() => setFSla(null)}
              title="Clear the SLA filter"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: 'transparent', border: '1px solid var(--border)',
                borderRadius: 128, padding: '4px 10px', fontSize: 11,
                color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              <i className="bi-x-lg" style={{ fontSize: 9 }} />
              Clear SLA filter
            </button>
          )}

          {/* 2026-05-28 (Pablo Gonzalez ask) — Zendesk SLA-metric chips.
              Lets the user narrow to "FRT" or "NRT" so combining with
              the Breached pill yields "all FRT breaches" or "all NRT
              breaches" in one click. Visible only when Zendesk is in
              scope (Workspace home or the Zendesk source tab — hiding
              on Jira / Deel source tabs avoids confusion since those
              rows don't carry slaMetric). */}
          {!workSource && fTool !== 'jira' && (() => {
            const METRIC_CHIPS = [
              { id: 'frt', label: 'FRT',  hint: 'First Reply Time — minutes until an agent has posted the first public reply on the ticket.' },
              { id: 'nrt', label: 'NRT',  hint: 'Next Reply Time — minutes until the next agent reply on a ticket that already had at least one.' },
              { id: 'rwt', label: 'RWT',  hint: 'Requester Wait Time — clock running while the ticket sits in a customer-pending state.' },
              { id: 'put', label: 'PUT',  hint: 'Periodic Update Time — clock running while agents owe the customer a recurring update.' },
            ];
            return (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  ZD metric
                </span>
                {METRIC_CHIPS.map(opt => {
                  const isActive = fSlaMetric === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setFSlaMetric(isActive ? null : opt.id)}
                      title={opt.hint}
                      style={{
                        height: 28, padding: '0 10px', borderRadius: 128,
                        border: '1px solid ' + (isActive ? '#0369a1' : 'var(--border)'),
                        background: isActive ? '#e0f2fe' : 'var(--surface)',
                        color: isActive ? '#0369a1' : 'var(--text-secondary)',
                        fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
                        cursor: 'pointer', whiteSpace: 'nowrap',
                      }}
                    >{opt.label}</button>
                  );
                })}
                {fSlaMetric && (
                  <button
                    type="button"
                    onClick={() => setFSlaMetric(null)}
                    title="Clear the Zendesk SLA-metric filter"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      background: 'transparent', border: '1px solid var(--border)',
                      borderRadius: 128, padding: '4px 10px', fontSize: 11,
                      color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <i className="bi-x-lg" style={{ fontSize: 9 }} />
                    Clear metric
                  </button>
                )}
              </div>
            );
          })()}

          {(isAdmin || isLead) && (() => {
            const sourceLabels = { onboarding: 'Onboarding', offboarding: 'Offboarding', amendments: 'Amendments', redlines: 'Redlines', workbench: 'Workbench', incentive_plans: 'Incentive Plans', immigration_tasks: 'Immigration Tasks', immigration_cases: 'Immigration Cases', hidden: 'Hidden' };
            const toolLabels = { zendesk: 'Zendesk', jira: 'Jira' };
            const viewLabel = sourceLabels[workSource] || toolLabels[fTool] || (isAdmin ? 'All Tasks' : user.team);
            return <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginLeft: 6 }}>{viewLabel}</span>;
          })()}
          {/* 2026-05-21 audit F25: "resolved" count on this header is a
              within-session accumulator from the FE merge — distinct from
              the Briefing's KPI tile which counts the FE state plus the
              persisted server-side 24h diff (PR #761). Surface the window
              inline so a user comparing the two pages doesn't try to
              reconcile mismatched scopes. */}
          <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <i className="bi-layers" style={{ fontSize: 11 }}></i>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>{headerCounts.open}</span> open
            {headerCounts.paused > 0 && <span title="Tasks paused / waiting on requester — excluded from the SLA tier pills."> &middot; <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{headerCounts.paused}</span> paused</span>}
            {headerCounts.resolved > 0 && <span title="Resolved within this session — Briefing's Resolved KPI also includes the persisted server-side 24h window."> &middot; <span style={{ fontWeight: 600, color: '#29811e' }}>{headerCounts.resolved}</span> resolved</span>}
            {/* 2026-05-22 — Celine Taruc request: eye toggle to hide the
                RESOLVED TODAY band. Persists per-user via useHideResolved.
                Only renders when there's actually a resolved set to hide,
                so users without resolved rows aren't confused by a dead
                toggle. */}
            {headerCounts.resolved > 0 && (
              <button
                type="button"
                onClick={toggleHideResolved}
                aria-pressed={hideResolved}
                title={hideResolved ? 'Show resolved tickets' : 'Hide resolved tickets'}
                style={{
                  marginLeft: 4, padding: '2px 6px', borderRadius: 6,
                  background: hideResolved ? '#f3eff8' : 'transparent',
                  border: hideResolved ? '1px solid #d4c4f0' : '1px solid var(--border)',
                  color: hideResolved ? '#7c3aed' : 'var(--text-muted)',
                  fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontFamily: 'inherit', transition: 'background .12s, border-color .12s',
                }}
              >
                <i className={hideResolved ? 'bi-eye-slash' : 'bi-eye'} style={{ fontSize: 11 }} />
                {hideResolved ? 'Show' : 'Hide'}
              </button>
            )}
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
          // 2026-05-25 — fCountry check added here so Jira/Zendesk tab
          // counts respect the country picker. Pablo Gonzalez (GIX)
          // reported the "numbers on Qs still stay the same in some
          // Queues" — Onboarding/Offboarding/Amendments/Redlines/
          // Workbench/IP/Immigration-Tasks already filtered counts via
          // applyPanelFilter; Jira/Zendesk did not because this gate
          // only checked status + unassigned. Now matches the row-level
          // filter at the top of the memoized chain so the tab badge
          // count agrees with what the table renders.
          const applyQueueFilter = (t) => {
            if (t.status === 'resolved') return false;
            if (fStatus.length && !fStatus.includes(t.status)) return false;
            if (fUnassigned && (t.assigneeId || t.assigneeEmail)) return false;
            if (fCountry.length && !fCountry.includes(canonicalCC(t.country))) return false;
            if (fAssignee.length && !fAssignee.includes((t.assigneeEmail || '').toLowerCase())) return false;
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
              : workSource === 'workbench' ? workbenchActiveRows
              : workSource === 'incentive_plans' ? incentivePlanRows
              : workSource === 'immigration_tasks' ? immigrationTaskActiveRows
              : workSource === 'immigration_cases' ? immigrationCaseActiveRows
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
          // Country options derived from every row the caller can currently
          // see — tickets via `baseVis`, Deel sources via `allSourceRows`.
          // Filtering to only countries that actually appear keeps the
          // dropdown lean (no offering EMEA codes to a NAM-only TL). Counts
          // reflect the union pre-country-filter so the user can see how
          // many rows each option would surface.
          const countryCounts = new Map();
          const tally = (cc) => {
            const code = canonicalCC(cc);
            if (!code) return;
            countryCounts.set(code, (countryCounts.get(code) || 0) + 1);
          };
          for (const t of baseVis) tally(t.country);
          for (const r of allSourceRows) tally(r?.country);
          const countryOptions = Array.from(countryCounts.entries())
            .map(([code, count]) => ({
              value: code,
              label: `${getFlag(code) || ''} ${getCountryName(code) || code}`.trim(),
              count,
            }))
            .sort((a, b) => a.label.localeCompare(b.label));
          // Jose Ruales 2026-06-09 — assignee filter options. Built from the
          // PRE-filter row sets (baseVis tickets + allSourceRows Deel) so every
          // assignee the caller can see stays selectable even while the filter
          // is active, and the counts reflect the pre-assignee-filter set —
          // exactly how countryOptions behaves. Name resolves via the live
          // roster, falling back to the row's own assignee name for external
          // users not in our directory.
          const assigneeCounts = new Map(); // email -> { count, name }
          const tallyAssignee = (email, name) => {
            const lc = (email || '').toLowerCase();
            if (!lc) return;
            const cur = assigneeCounts.get(lc);
            if (cur) { cur.count++; if (!cur.name && name) cur.name = name; }
            else assigneeCounts.set(lc, { count: 1, name: name || '' });
          };
          for (const t of baseVis) tallyAssignee(t.assigneeEmail, resolveAssignee(t).name);
          for (const r of allSourceRows) tallyAssignee(r?.assigneeEmail, r?.assignee);
          const assigneeOptions = Array.from(assigneeCounts.entries())
            .map(([email, { count, name }]) => ({
              value: email,
              label: MEMBERS_BY_EMAIL[email]?.name || name || email,
              count,
            }))
            .sort((a, b) => a.label.localeCompare(b.label));
          return (
            // overflow:visible + flex-wrap so the Status filter popover (which
            // is position:absolute) is not clipped by the parent's scroll
            // context. The previous overflow:auto silently swallowed the menu;
            // wrap also gives narrow desktops / tablets a usable layout instead
            // of a horizontal-scroll filter row.
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', overflow: 'visible', paddingBottom: 2 }}>
              {[...WORK_SOURCES, WORK_TASKS_TAB, HIDDEN_TAB].filter(ws => {
                // Phase 14.1 visibility gate: if a Deel source is set to
                // false in the current dept's profile, drop its tab from
                // the row. The hook starts with EMPTY_VISIBLE_SOURCES
                // (all false) and resolves to the real values once
                // /dept-scope/current returns — during that brief window
                // we let unknown ids through, then hide on next render.
                return isDeptSourceVisible(ws.id, visibleSources, deptState?.loading);
              }).map(ws => {
                const isQueueFilter = ws.id === 'zendesk' || ws.id === 'jira';
                const isActive = isQueueFilter ? (fTool === ws.id && !workSource) : workSource === ws.id;
                const count = ws.id === 'onboarding' ? visOnboardingRows.length
                  : ws.id === 'offboarding' ? visOffboardingRows.length
                  : ws.id === 'amendments' ? visAmendmentRows.length
                  : ws.id === 'redlines' ? visRedlineRows.length
                  // 2026-05-28 (Raquel feedback) — Workbench badge counts
                  // Mine only (active + paused assigned to the viewer), not
                  // the country-fallback Others bucket. Other sources keep
                  // the visible-rows count because their Others IS legitimate
                  // country pipeline (Onb/Off/Amend/Redline owners triage
                  // their country queues as part of normal work). Workbench
                  // Others is unassigned-orphan fallback only; counting it
                  // here misrepresents the viewer's actual personal load.
                  //
                  // 2026-05-29 — fall back to the total open count when the
                  // viewer has zero rows personally assigned. Without this,
                  // RM/Admin (and TLs with an empty personal queue) saw the
                  // badge stuck at 0 even when the dept queue had hundreds
                  // of open rows — they have no MINE so the personal-load
                  // signal collapses to the whole queue.
                  : ws.id === 'workbench' ? (() => {
                      const lc = (user?.email || '').toLowerCase();
                      const totalOpen = visWorkbenchRows.filter(r => !r.isResolved).length;
                      if (!lc) return totalOpen;
                      const mineOpen = visWorkbenchRows.filter(r =>
                        !r.isResolved && (r.assigneeEmail || '').toLowerCase() === lc,
                      ).length;
                      return mineOpen > 0 ? mineOpen : totalOpen;
                    })()
                  : ws.id === 'incentive_plans' ? visIncentivePlanRows.length
                  : ws.id === 'immigration_tasks' ? visImmigrationTaskRows.filter(r => !r.isResolved).length
                  : ws.id === 'immigration_cases' ? visImmigrationCaseRows.length
                  : ws.id === 'jira' ? jiraCount
                  : ws.id === 'zendesk' ? zdCount
                  : ws.id === 'hidden' ? scopedHiddenItems.length
                  : ws.id === 'work_tasks' ? null
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
                    {count != null && (
                      <span style={{
                        padding: '1px 7px', borderRadius: 128, fontSize: 10, fontWeight: 700,
                        background: isActive ? `${ws.color}20` : '#f2f2f2',
                        color: isActive ? ws.color : '#9e9e9e',
                      }}>{count}</span>
                    )}
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

              {countryOptions.length > 0 && (
                <MultiFilterDropdown
                  icon="bi-globe2"
                  label="Country"
                  selected={fCountry}
                  options={countryOptions}
                  onChange={setFCountry}
                  activeColor="#1f74b3"
                />
              )}

              {/* Assignee filter — parity with HR Hub. Shown when more than one
                  assignee is present (a lone-assignee agent view doesn't need
                  it) OR a filter is already active so it stays clearable. */}
              {(assigneeOptions.length > 1 || fAssignee.length > 0) && (
                <MultiFilterDropdown
                  icon="bi-person-check"
                  label="Assignee"
                  selected={fAssignee}
                  options={assigneeOptions}
                  onChange={setFAssignee}
                  activeColor="#7c3aed"
                />
              )}

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
                  onClick={() => { setFTool(null); setFStatus([]); setFSla(null); setFSlaMetric(null); setFUnassigned(false); setFCountry([]); setFAssignee([]); setSearch(''); setFJiraActionable(true); setFJiraRaised(false); }}
                  title={`Your active filters are hiding ${hiddenByFilters} ${hiddenByFilters === 1 ? 'task' : 'tasks'}. Click to clear all filters.`}
                  style={{ height: 32, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 10px', borderRadius: 8, background: '#fff7ed', border: '1px solid #fed7aa', color: '#b45309', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer', fontFamily: 'inherit' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#ffedd5'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#fff7ed'; }}
                >
                  <i className="bi-funnel-fill" style={{ fontSize: 10 }}></i>
                  Filters hiding {hiddenByFilters} — clear
                </button>
              )}

              {hasActiveFilters && (
                <button onClick={() => { setFTool(null); setFStatus([]); setFSla(null); setFSlaMetric(null); setFUnassigned(false); setFCountry([]); setFAssignee([]); setSearch(''); setFJiraActionable(true); setFJiraRaised(false); }} style={{ height: 32, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 10px', borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'underline' }}>
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
            notesApi={taskNotes}
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
            onSlaExtension={(row) => setSlaExtensionModalTask({ source: 'onboarding', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onEscalate={(row) => setEscalateModalTask({ source: 'onboarding', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onReassign={canReassign ? (row) => setReassignModalTask({ source: 'onboarding', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country, assigneeEmail: row.assigneeEmail || null, assigneeName: row.assignee || null, hasOverride: !!row.reassignedFromEmail }) : null}
            onBulkHide={(rows) => setBulkHideTasks(rows.map(r => buildTaskDescriptor(r, 'onboarding')))}
            onBulkSlaExtension={(rows) => setBulkSlaExtensionTasks(rows.map(r => buildTaskDescriptor(r, 'onboarding')))}
            onBulkReassign={canReassign ? (rows) => setBulkReassignTasks(rows.map(r => buildTaskDescriptor(r, 'onboarding'))) : null}
          />
        </ErrorBoundary>
      )}
      {workSource === 'offboarding' && (
        <ErrorBoundary>
          <SourceTable
            viewerEmail={user?.email}
            notesApi={taskNotes}
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
            onSlaExtension={(row) => setSlaExtensionModalTask({ source: 'offboarding', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onEscalate={(row) => setEscalateModalTask({ source: 'offboarding', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onBulkHide={(rows) => setBulkHideTasks(rows.map(r => buildTaskDescriptor(r, 'offboarding')))}
            onBulkSlaExtension={(rows) => setBulkSlaExtensionTasks(rows.map(r => buildTaskDescriptor(r, 'offboarding')))}
            hideFilterBar
          />
        </ErrorBoundary>
      )}
      {workSource === 'amendments' && (
        <ErrorBoundary>
          <SourceTable
            viewerEmail={user?.email}
            notesApi={taskNotes}
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
            onSlaExtension={(row) => setSlaExtensionModalTask({ source: 'amendments', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onEscalate={(row) => setEscalateModalTask({ source: 'amendments', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onReassign={canReassign ? (row) => setReassignModalTask({ source: 'amendments', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country, assigneeEmail: row.assigneeEmail || null, assigneeName: row.assignee || null, hasOverride: !!row.reassignedFromEmail }) : null}
            onBulkHide={(rows) => setBulkHideTasks(rows.map(r => buildTaskDescriptor(r, 'amendments')))}
            onBulkSlaExtension={(rows) => setBulkSlaExtensionTasks(rows.map(r => buildTaskDescriptor(r, 'amendments')))}
            onBulkReassign={canReassign ? (rows) => setBulkReassignTasks(rows.map(r => buildTaskDescriptor(r, 'amendments'))) : null}
          />
        </ErrorBoundary>
      )}
      {workSource === 'redlines' && (
        <ErrorBoundary>
          <SourceTable
            viewerEmail={user?.email}
            notesApi={taskNotes}
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
            onSlaExtension={(row) => setSlaExtensionModalTask({ source: 'redlines', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onEscalate={(row) => setEscalateModalTask({ source: 'redlines', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onReassign={canReassign ? (row) => setReassignModalTask({ source: 'redlines', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country, assigneeEmail: row.assigneeEmail || null, assigneeName: row.assignee || null, hasOverride: !!row.reassignedFromEmail }) : null}
            onBulkHide={(rows) => setBulkHideTasks(rows.map(r => buildTaskDescriptor(r, 'redlines')))}
            onBulkSlaExtension={(rows) => setBulkSlaExtensionTasks(rows.map(r => buildTaskDescriptor(r, 'redlines')))}
            onBulkReassign={canReassign ? (rows) => setBulkReassignTasks(rows.map(r => buildTaskDescriptor(r, 'redlines'))) : null}
          />
        </ErrorBoundary>
      )}
      {workSource === 'workbench' && (
        <ErrorBoundary>
          <SourceTable
            viewerEmail={user?.email}
            notesApi={taskNotes}
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
            sourceKey="workbench"
            othersCollapsible
            othersDefaultCollapsed
            onHide={(row) => setHideModalTask({ source: 'workbench', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onSlaExtension={(row) => setSlaExtensionModalTask({ source: 'workbench', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onEscalate={(row) => setEscalateModalTask({ source: 'workbench', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onBulkHide={(rows) => setBulkHideTasks(rows.map(r => buildTaskDescriptor(r, 'workbench')))}
            onBulkSlaExtension={(rows) => setBulkSlaExtensionTasks(rows.map(r => buildTaskDescriptor(r, 'workbench')))}
          />
        </ErrorBoundary>
      )}
      {workSource === 'incentive_plans' && (
        <ErrorBoundary>
          <SourceTable
            viewerEmail={user?.email}
            notesApi={taskNotes}
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
            onSlaExtension={(row) => setSlaExtensionModalTask({ source: 'incentive_plans', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onEscalate={(row) => setEscalateModalTask({ source: 'incentive_plans', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onReassign={canReassign ? (row) => setReassignModalTask({ source: 'incentive_plans', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country, assigneeEmail: row.assigneeEmail || null, assigneeName: row.assignee || null, hasOverride: !!row.reassignedFromEmail }) : null}
            onBulkHide={(rows) => setBulkHideTasks(rows.map(r => buildTaskDescriptor(r, 'incentive_plans')))}
            onBulkSlaExtension={(rows) => setBulkSlaExtensionTasks(rows.map(r => buildTaskDescriptor(r, 'incentive_plans')))}
            onBulkReassign={canReassign ? (rows) => setBulkReassignTasks(rows.map(r => buildTaskDescriptor(r, 'incentive_plans'))) : null}
          />
        </ErrorBoundary>
      )}
      {workSource === 'immigration_tasks' && (
        <ErrorBoundary>
          {/* 2026-05-22: GIX-only source. Subject = "Applicant · Case"
              one-liner. clientName=organization, typeLabel=task type
              ("Document upload" / "Form filling" / etc.). Sorted by
              SLA tier so the most urgent due dates surface first. */}
          <SourceTable
            viewerEmail={user?.email}
            notesApi={taskNotes}
            rows={tblImmigrationTaskRows}
            loading={immigrationTasksData.loading}
            error={immigrationTasksData.error}
            onRefresh={immigrationTasksData.refresh}
            emptyIcon="bi-passport"
            emptyLabel="No immigration tasks"
            emptySubLabel="All Mobility actions are caught up"
            sortDefault="sla"
            showClient
            showType
            hideStatusPills
            hideUpdated
            hideContract
            dateField="dueDate"
            dateLabel="Due Date"
            /* 2026-05-22 — Pablo Gonzalez ask: primary column carries the
               task name ("Document upload" / "Form filling" / "Quote
               approval" — what admin calls "Task type"). Secondary
               column carries "Applicant · Case" so triage sees who/what
               the task is for. Both header labels updated to match the
               data the column actually shows. */
            subjectLabel="Task"
            clientLabel="Applicant · Case"
            onHide={(row) => setHideModalTask({ source: 'immigration_tasks', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onSlaExtension={(row) => setSlaExtensionModalTask({ source: 'immigration_tasks', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onEscalate={(row) => setEscalateModalTask({ source: 'immigration_tasks', id: String(row.id), url: row.taskUrl || null, subject: row.subject, country: row.country })}
            onBulkHide={(rows) => setBulkHideTasks(rows.map(r => buildTaskDescriptor(r, 'immigration_tasks')))}
          />
        </ErrorBoundary>
      )}
      {workSource === 'immigration_cases' && (
        <ErrorBoundary>
          {/* 2026-06-03: GIX-only Immigration Cases — bespoke 12-column table
              (Deel mobility cases, OPEN + ON_HOLD). Read-only; clicking a row
              opens the case in admin.deel.network. */}
          <ImmigrationCasesTable
            rows={tblImmigrationCaseRows}
            loading={immigrationCasesData.loading}
            error={immigrationCasesData.error}
            onRefresh={immigrationCasesData.refresh}
          />
        </ErrorBoundary>
      )}
      {workSource === 'hidden' && (
        <ErrorBoundary>
          <HiddenTasksPanel hiddenTasks={scopedHiddenTasks} />
        </ErrorBoundary>
      )}
      {workSource === 'work_tasks' && (
        <ErrorBoundary>
          <TasksQueuePanel user={user} focusTaskId={focusTaskId} onTaskFocused={onTaskFocused} />
        </ErrorBoundary>
      )}

      {/* ── Workspace Home — default landing ──────────────────────────────
          Renders when nothing is selected and no filters are active. Shows
          the admin-editable Priority of the Day banner + the 4-step
          working-order guide (Breaches → Zendesk → Workbench → Rest).
          As soon as the user picks a tool / source / filter, the existing
          merged ZD/Jira table or source panel takes over. */}
      {!workSource && !fTool && !hasActiveFilters && (
        <ErrorBoundary>
          <WorkspaceHome
            user={user}
            onSelectTool={(t) => { setWorkSource(null); setFTool(t); }}
            onSelectSource={(s) => { setFTool(null); setWorkSource(s); }}
            onFilterBreached={() => { setFSla('breached'); }}
            // Paulina Furmaniuk 2026-05-26 — the Zendesk step card on
            // workspace home reported 70 while the Zendesk filter showed
            // 28. Root cause: baseVis is the unfiltered scoped pool (per-
            // user "Hide resolved" toggle is applied later), so a viewer
            // with the toggle OFF carries resolved tickets through into
            // the home count. The tile labels itself "tickets open" + the
            // ticketRows prop contract already says "status !== 'resolved'"
            // (WorkspaceHome.jsx:66), so both ticket sources must filter
            // resolved out before counting — matches the Zendesk/Jira tab
            // pills that use applyQueueFilter (Queue.jsx:1224).
            zdCount={baseVis.filter(t => t.source === 'zendesk' && t.status !== 'resolved').length}
            jiraCount={baseVis.filter(t => t.source === 'jira' && t.status !== 'resolved').length}
            ticketRows={baseVis.filter(t => (t.source === 'zendesk' || t.source === 'jira') && t.status !== 'resolved')}
            onboardingCount={onboardingRows.length}
            offboardingCount={offboardingRows.length}
            amendmentsCount={amendmentRows.length}
            redlinesCount={redlineRows.length}
            workbenchCount={workbenchActiveRows.length}
            incentivePlansCount={incentivePlanRows.length}
            // Paused (on-hold) sub-counts — fed to the breakdown line on each
            // step card. Carolina Ferreira 2026-05-25 feedback: "25 open ZD
            // tickets, when in fact I only 3 that are open, and 22 paused."
            // Tickets pause via Zendesk status='hold' (normalised to 'waiting'
            // in our pipeline). Deel sources carry an explicit isPaused flag
            // per row.
            zdPausedCount={baseVis.filter(t => t.source === 'zendesk' && t.status === 'waiting').length}
            jiraPausedCount={baseVis.filter(t => t.source === 'jira' && t.status === 'waiting').length}
            onboardingPausedCount={onboardingRows.filter(r => r.isPaused).length}
            offboardingPausedCount={offboardingRows.filter(r => r.isPaused).length}
            amendmentsPausedCount={amendmentRows.filter(r => r.isPaused).length}
            redlinesPausedCount={redlineRows.filter(r => r.isPaused).length}
            workbenchPausedCount={workbenchActiveRows.filter(r => r.isPaused).length}
            incentivePlansPausedCount={incentivePlanRows.filter(r => r.isPaused).length}
            sourceRowsAll={allSourceRows}
            breachedCount={workspaceHomeSla.breachedCount}
          />
        </ErrorBoundary>
      )}

      {/* ── Main ZD/JR table (when no work source is active) ── */}
      {!workSource && (fTool || hasActiveFilters) && (
        <div ref={ticketScrollerRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', background: 'var(--surface-2)' }}>

          {/* Truncation hint — Sarah Suge 2026-05-11 feedback: when scrolling
              to the bottom the listing was cut off because Zendesk Search's
              1000-hit/query hard cap (or Jira's MAX_ISSUES_PER_CLAUSE) was
              hit and the older rows silently dropped. Now the backend tells
              us which source was capped and we render this hint so the
              viewer knows to refine their filter rather than wonder where
              the missing tickets went.
              Suppressed while a refresh is in flight (counts settle from
              the cache mid-fetch and produce a false-positive flash). */}
          {(() => {
            const zdSrc = syncSources?.zendesk;
            const jrSrc = syncSources?.jira;
            const zdTrunc = !!zdSrc?.truncated && (!fTool || fTool === 'zendesk');
            const jrTrunc = !!jrSrc?.truncated && (!fTool || fTool === 'jira');
            const anyTrunc = (zdTrunc || jrTrunc)
              && !(zdSrc?.isRefreshing || jrSrc?.isRefreshing);
            if (!anyTrunc) return null;
            const parts = [];
            if (zdTrunc) parts.push(`Zendesk shows ${zdSrc.count}${zdSrc.serverTotal ? ` of ${zdSrc.serverTotal}` : ''}`);
            if (jrTrunc) parts.push(`Jira shows ${jrSrc.count}`);
            return (
              <div
                role="status"
                style={{
                  margin: '12px 16px 0', padding: '10px 14px',
                  background: '#fff8e6', border: '1px solid #fde68a',
                  borderRadius: 10,
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  fontSize: 12, color: '#92400e',
                }}>
                <i className="bi-exclamation-circle-fill" style={{ fontSize: 14, color: '#d97706', flexShrink: 0, marginTop: 1 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>Some tickets may be hidden</div>
                  <div style={{ lineHeight: 1.5 }}>
                    {parts.join(' · ')}. Search and filter (Status / Unassigned / Country / SLA) to narrow the list and surface specific tickets that aren&apos;t in the visible chunk.
                  </div>
                </div>
              </div>
            );
          })()}
          {/* Breaches-across-sources hand-off panel. Renders whenever the
              breached filter is on and nothing source-specific is selected,
              so the user lands somewhere they can see + click into the
              breaches that live in Deel sources. Without this, fSla='breached'
              looked empty for users whose breaches were all in Workbench /
              Onboarding etc., because the merged ticket table only renders
              ZD + Jira rows. */}
          {fSla === 'breached' && !fTool && (() => {
            const breachSummary = [
              { id: 'workbench',       label: 'Workbench',       icon: 'bi-grid-3x3-gap-fill', color: '#0369a1', bg: '#eff6ff', count: tblWorkbenchRows.length },
              { id: 'onboarding',      label: 'Onboarding',      icon: 'bi-person-plus-fill',  color: '#7c3aed', bg: '#f3eff8', count: tblOnboardingRows.length },
              { id: 'offboarding',     label: 'Offboarding',     icon: 'bi-person-dash-fill',  color: '#d42d35', bg: '#fef2f2', count: tblOffboardingRows.length },
              { id: 'amendments',      label: 'Amendments',      icon: 'bi-pencil-square',     color: '#ed8d00', bg: '#fff8e6', count: tblAmendmentRows.length },
              { id: 'redlines',        label: 'Redlines',        icon: 'bi-file-earmark-diff', color: '#7c3aed', bg: '#f3eff8', count: tblRedlineRows.length },
              { id: 'incentive_plans', label: 'Incentive Plans', icon: 'bi-cash-coin',         color: '#0e7490', bg: '#ecfeff', count: tblIncentivePlanRows.length },
            ].filter(s => s.count > 0);
            if (breachSummary.length === 0) return null;
            const total = breachSummary.reduce((n, s) => n + s.count, 0);
            return (
              <div style={{
                margin: '16px 16px 12px', padding: '14px 16px',
                background: '#fff', border: '1px solid #fecaca', borderRadius: 12,
                boxShadow: '0 1px 2px rgba(212, 45, 53, 0.06)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <i className="bi-exclamation-octagon-fill" style={{ fontSize: 14, color: '#d42d35' }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    {total} breached {total === 1 ? 'item' : 'items'} in other queues
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
                    — click a queue to drill in
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {breachSummary.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => { setWorkSource(s.id); }}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        padding: '8px 14px', borderRadius: 10,
                        border: `1px solid ${s.color}33`, background: s.bg,
                        cursor: 'pointer', transition: 'all .12s',
                        fontFamily: 'inherit',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = s.color; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = `${s.color}33`; e.currentTarget.style.transform = 'translateY(0)'; }}
                      title={`Open ${s.label} filtered to breached items`}
                    >
                      <i className={s.icon} style={{ fontSize: 13, color: s.color }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{s.label}</span>
                      <span style={{
                        padding: '1px 8px', borderRadius: 128, fontSize: 11, fontWeight: 700,
                        background: '#d42d35', color: '#fff', fontVariantNumeric: 'tabular-nums',
                      }}>{s.count}</span>
                      <i className="bi-arrow-right" style={{ fontSize: 11, color: s.color }} />
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
          {all.length === 0 ? (
            hasActiveFilters
              ? (() => {
                  // If breached filter is on and Deel sources have breaches,
                  // the panel above already explained where to go. Tone the
                  // ticket empty state down so the user doesn't think "no
                  // tasks found" contradicts the "3 breached items" CTA they
                  // just clicked.
                  const otherSourceBreaches = fSla === 'breached' && !fTool
                    ? tblWorkbenchRows.length + tblOnboardingRows.length + tblOffboardingRows.length + tblAmendmentRows.length + tblRedlineRows.length + tblIncentivePlanRows.length
                    : 0;
                  return (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                      <i className="bi bi-inbox" style={{ fontSize: 32, display: 'block', marginBottom: 12, opacity: 0.3 }}/>
                      {fSla === 'breached' && otherSourceBreaches > 0 ? (
                        <>
                          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>No breached tickets</div>
                          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                            All ZD &amp; Jira tickets are within SLA. Check the queues above for the {otherSourceBreaches} {otherSourceBreaches === 1 ? 'breach' : 'breaches'} in other sources.
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>No tasks found</div>
                          {hiddenByFilters > 0 ? (
                            <>
                              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
                                Your active filters are hiding {hiddenByFilters} {hiddenByFilters === 1 ? 'task' : 'tasks'} in your scope.
                              </div>
                              <button
                                type="button"
                                onClick={() => { setFTool(null); setFStatus([]); setFSla(null); setFSlaMetric(null); setFUnassigned(false); setFCountry([]); setFAssignee([]); setSearch(''); setFJiraActionable(true); setFJiraRaised(false); }}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: '1px solid #1f74b3', background: '#1f74b3', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                              >
                                <i className="bi-x-circle" style={{ fontSize: 12 }}></i>
                                Clear filters
                              </button>
                            </>
                          ) : (
                            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Try adjusting your filters</div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })()
              : <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: 40, textAlign: 'center', minHeight: 300 }}>
                  <i className="bi-inbox" style={{ fontSize: 48, color: '#c0c0c0', display: 'block', marginBottom: 16 }}></i>
                  <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Queue is clear</div>
                  <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>All caught up</div>
                </div>
          ) : (
            <table
              ref={tableElRef}
              style={{
                width: '100%', borderCollapse: 'collapse', fontSize: 13,
                // Inline CSS variable consumed by the Subject th + the
                // Subject td in QueueRow. Mutated directly via tableElRef
                // during drag for instant resizing without re-rendering
                // every virtualized row.
                '--queue-subject-width': `${subjectWidth}px`,
              }}
              role="grid"
              aria-label="Task queue"
            >
              <thead>
                <tr style={{ background: 'var(--surface-2)', position: 'sticky', top: 0, zIndex: 2 }}>
                  <SortableTh col="source"   label="Source"   width={70}  sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                  <ResizableSubjectTh
                    sortCol={sortCol}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    onResizeStart={handleSubjectResizeStart}
                  />
                  <SortableTh col="function" label="Function" width={78}  sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh col="country"  label="Country"  width={50}  sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                  {/* Requester — the employee/customer who raised the ticket.
                      Anne Sanmartin 2026-05-19 feedback "when going through
                      the ZD tickets, searching with the requester can be
                      helpful, specially is you have several tickets with
                      the same topic". Source: `task.requesterName` (and
                      `requesterEmail` for the hover tooltip), both already
                      populated by /api/v1/queue for Zendesk + Jira. */}
                  <SortableTh col="requester" label="Requester" width={104} align="left" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh col="assignee" label="Assignee" width={72}  sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh col="received" label="Received" width={58}  sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                  {settings.sla_enabled !== false && (
                    <SortableTh col="sla" label="SLA" width={54} sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} tooltip="Sorted by triage tier first (Breached → At Risk → On Track), then oldest within each tier — not by raw SLA value. Hover any row's SLA pill for the exact remaining/over time." />
                  )}
                  <SortableTh col="status"   label="Status"   width={78}  sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                  <th scope="col" style={{ ...thStyle, width: 56 }}>Link</th>
                  <th scope="col" style={{ ...thStyle, width: 44 }} title="Personal notes — saved to your browser, keyed by the task's source+id">Note</th>
                  <th scope="col" style={{ ...thStyle, width: 136 }}>Actions</th>
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
                    onSlaExtension={() => setSlaExtensionModalTask(taskDescriptor)}
                    onEscalate={() => setEscalateModalTask(taskDescriptor)}
                    hasNote={taskNotes.hasNote(task.source, task.id)}
                    onOpenNote={() => setNoteModalTask(task)}
                    escalateLabel={hubBrand.escalateLabel}
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

      {/* SLA Extension request modal — opens from any row's "SLA Extension"
          action across all 8 sources (tickets + 6 Deel sources). Phase 1
          ships the request; Phase 2 wires the manager review in HR Hub;
          Phase 3 propagates the override into SLA math. See
          SLA_EXTENSIONS_PLAN.md. */}
      {slaExtensionModalTask && (
        <CreateSlaExtensionModal
          task={slaExtensionModalTask}
          onClose={() => {
            setSlaExtensionModalTask(null);
            // 2026-05-22 — refresh the SLA extension list so the row's
            // "Ext. requested" badge appears immediately after a new
            // request is submitted, instead of waiting up to 30s for
            // the next poll. The hook short-circuits if a fetch is
            // already in flight, so this is safe to call on every
            // close (even cancellations).
            try { slaExtensions?.refresh?.(); } catch {}
          }}
        />
      )}

      {/* Note editor modal for ZD/Jira tickets — SourceTable rows render
          their own modal internally, but QueueRow (ZD/Jira) is a top-level
          render so the modal lives here. Shape mirrors the SourceTable
          variant exactly to keep the experience consistent. */}
      {noteModalTask && (
        <TicketNoteModal
          task={noteModalTask}
          initialText={taskNotes.getNote(noteModalTask.source, noteModalTask.id)}
          maxLength={taskNotes.maxLength}
          onSave={(text) => { taskNotes.setNote(noteModalTask.source, noteModalTask.id, text); setNoteModalTask(null); }}
          onDelete={() => { taskNotes.removeNote(noteModalTask.source, noteModalTask.id); setNoteModalTask(null); }}
          onClose={() => setNoteModalTask(null)}
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
            // force=true so every source bypasses its CACHE_TTL throttle AND
            // overwrites even when the reassigned row was the last one in this
            // user's scope (server now legitimately returns empty). Without it
            // the row stays painted until the next poll — the "reassigned but
            // still on my side" bug. See useQueueUnifiedSync.refreshAll.
            try { syncRefreshAll && syncRefreshAll(true); } catch {}
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
            // force=true — same reason as the single-row reassign above:
            // bypass the per-source TTL throttle + overwrite empty results so
            // every reassigned row leaves this user's view immediately.
            try { syncRefreshAll && syncRefreshAll(true); } catch {}
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

      {/* Bulk SLA extension — CreateSlaExtensionModal in `tasks` mode. Bulk
          caps the hold at 1–2 days so every request auto-approves and applies
          immediately; one request fires per selected task. Refresh the
          extension list on close so the rows show their "Extended" state. */}
      {bulkSlaExtensionTasks && bulkSlaExtensionTasks.length > 0 && (
        <CreateSlaExtensionModal
          tasks={bulkSlaExtensionTasks}
          onClose={() => {
            setBulkSlaExtensionTasks(null);
            try { slaExtensions?.refresh?.(); } catch {}
          }}
        />
      )}
    </div>
  );
};

// ── SLA filter pill (workspace header) ────────────────────────────────
// Three tones — ok / atRisk / breached. Active state is a SOLID filled
// chip with white text + a check icon so the user can see at a glance
// which filter is on (Carolina Ferreira 2026-05-14: "Improve the
// visibility of the filters under the Workspace"). Inactive state is
// the existing soft pastel so the row still reads as three semantic
// statuses. `hint` is rendered into the tooltip so hover explains what
// each filter does before the user has to click to find out.
const SLA_PILL_TONES = {
  ok:       { iconClass: 'bi-check-circle-fill',       activeBg: '#15803d', activeText: '#ffffff', inactiveBg: '#f0fdf4', inactiveText: '#166534', inactiveBorder: '#bbf7d0' },
  atRisk:   { iconClass: 'bi-exclamation-circle-fill', activeBg: '#d97706', activeText: '#ffffff', inactiveBg: '#fff8e6', inactiveText: '#92400E', inactiveBorder: '#ffe27c' },
  breached: { iconClass: 'bi-x-circle-fill',           activeBg: '#d42d35', activeText: '#ffffff', inactiveBg: '#ffe2de', inactiveText: '#991b1b', inactiveBorder: '#fca5a5' },
};
const SlaPill = ({ active, onClick, tone, count, label, hint }) => {
  const t = SLA_PILL_TONES[tone] || SLA_PILL_TONES.ok;
  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); }
  };
  return (
    <div
      onClick={onClick}
      onKeyDown={handleKey}
      title={`${label} — ${hint}${active ? ' (active — click again to clear)' : ' (click to filter)'}`}
      role="button"
      aria-pressed={active}
      tabIndex={0}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: active ? t.activeBg : t.inactiveBg,
        border: `1px solid ${active ? t.activeBg : t.inactiveBorder}`,
        borderRadius: 128, padding: '5px 14px',
        cursor: 'pointer', transition: 'all .15s', flexShrink: 0,
        boxShadow: active ? '0 1px 4px rgba(15,23,42,0.18)' : 'none',
        outline: 'none',
      }}
    >
      {active && (
        <i className="bi-check-lg" style={{ color: t.activeText, fontSize: 12 }} aria-hidden="true" />
      )}
      <i className={t.iconClass} style={{ color: active ? t.activeText : t.inactiveText, fontSize: 13 }} aria-hidden="true" />
      <span style={{ fontSize: 13, fontWeight: 700, color: active ? t.activeText : t.inactiveText }}>{count}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: active ? t.activeText : t.inactiveText }}>{label}</span>
    </div>
  );
};

// ── Table row component ──
const QueueRow = memo(({ task, slaAgeClass, settings, onHide, onSlaExtension, onEscalate, hasNote = false, onOpenNote = null, escalateLabel = 'Escalate to HR Hub' }) => {
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
          Without this the user had to leave the app to read the full title.
          maxWidth reads the user-resizable `--queue-subject-width` CSS
          variable set on the parent <table> (see ResizableSubjectTh below
          + the drag handler in the Queue component). Fallback of 480px
          covers the legacy/SSR path where the variable isn't yet defined
          — also the new default per Carolina Ferreira's 2026-05-20 ask
          (up from the previous fixed 320). */}
      <td title={task.subject || ''} style={{ ...tdStyle, textAlign: 'left', fontWeight: 600, color: 'var(--text)', maxWidth: 'var(--queue-subject-width, 480px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {task.isAlert && <span className="pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: '#ed8d00', flexShrink: 0 }}></span>}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.subject}</span>
          {task.linkedTickets && task.linkedTickets.length > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '1px 6px', borderRadius: 128, background: '#f2f2f2', fontSize: 10, color: 'var(--text-secondary)', flexShrink: 0 }}>
              <i className="bi-link-45deg" style={{ fontSize: 9 }}></i>{task.linkedTickets.length}
            </span>
          )}
        </div>
      </td>
      {/* Function */}
      <td style={tdStyle}>
        {fn ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 128, background: fn.bg || '#f2f2f2', color: fn.color || '#616161', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>{fn.label}</span> : <span style={{ color: '#d5d5d5' }}>--</span>}
      </td>
      {/* Country — flag + full name. Standard agreed 2026-05-19 (Mohamed):
          country NAME everywhere, not the ISO code. */}
      <td title={task.country ? getCountryName(task.country) : ''} style={{ ...tdStyle, fontSize: 12 }}>
        {task.country && <span>{getFlag(task.country)} <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{getCountryName(task.country) || task.country}</span></span>}
      </td>
      {/* Requester — the employee/customer who raised the ticket. Hover
          tooltip carries the email so the user can spot multiple tickets
          from the same person at a glance (Anne Sanmartin 2026-05-19). */}
      <td
        title={task.requesterName
          ? `${task.requesterName}${task.requesterEmail ? ` <${task.requesterEmail}>` : ''}`
          : 'Requester unknown'}
        style={{ ...tdStyle, textAlign: 'left', fontSize: 12, color: 'var(--text)', maxWidth: 140 }}
      >
        {task.requesterName
          ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
              <Avatar name={task.requesterName} size="xs"/>
              <span style={{
                fontWeight: 500, whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{task.requesterName}</span>
            </div>
          )
          : <span style={{ color: '#d5d5d5' }}>--</span>}
      </td>
      {/* Assignee — full name in title attr; cell only displays first name. */}
      <td title={assignee.name || 'Unassigned'} style={tdStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
          <Avatar name={assignee.name} size="xs"/>
          <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{assignee.name?.split(' ')[0] || ''}</span>
        </div>
      </td>
      {/* Received */}
      <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{relTime(task.minutesAgo)}</td>
      {/* SLA */}
      {settings.sla_enabled !== false && <td style={tdStyle}><SlaBadge sla={sla} status={task.status}/></td>}
      {/* Status — Jira tickets surface the raw status name as a sub-label
          (HRX Review / PRM Review / Client Approval / etc.) so managers
          can see exactly which workflow stage each ticket is in without
          opening it. The bucket (in_progress / waiting / etc.) still
          drives the colour + tier-based scoping. */}
      <td style={tdStyle}>
        <StatusBadge
          status={task.status}
          subStatus={task.source === 'jira' ? task.jiraStatus : null}
        />
      </td>
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
      {/* Note — sticky-note icon. Filled amber if a note exists. */}
      <td style={tdStyle}>
        {onOpenNote && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenNote(); }}
            aria-label={hasNote ? `Edit note on "${task.subject || task.id}"` : `Add note to "${task.subject || task.id}"`}
            title={hasNote ? 'Edit personal note' : 'Add personal note'}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 24, padding: 0, borderRadius: 6,
              background: hasNote ? '#fef7e0' : (hov ? '#fff8e6' : '#f5f4f2'),
              color: hasNote ? '#b7791f' : (hov ? '#b7791f' : '#9e9e9e'),
              border: hasNote ? '1px solid #f4d96b' : (hov ? '1px solid #f4d96b' : '1px solid transparent'),
              cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s',
            }}
          >
            <i className={hasNote ? 'bi-sticky-fill' : 'bi-sticky'} style={{ fontSize: 12 }} />
          </button>
        )}
      </td>
      {/* Actions */}
      <td style={tdStyle}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            onClick={() => onEscalate?.()}
            aria-label={`${escalateLabel}: "${task.subject || task.id}"`}
            title={escalateLabel}
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
          {onSlaExtension && (() => {
            // 2026-05-22 — mirrors the SourceTable lockout (see comment
            // there). When an extension is active with >12h remaining
            // OR a pending request is in review, render a non-clickable
            // badge so requesters don't re-click and get 409'd.
            const locked = isSlaExtensionLocked(task);
            if (locked) {
              const isPending = !!task.slaExtensionPending;
              const ext = task.slaExtension;
              const expiresAt = ext?.expiresAt ? new Date(ext.expiresAt) : null;
              const expiresLabel = expiresAt && !isNaN(expiresAt)
                ? expiresAt.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                : null;
              const tooltip = isPending
                ? `SLA extension request is in review (submitted ${task.slaExtensionPending?.createdAt ? new Date(task.slaExtensionPending.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'recently'}). You can request another once it resolves.`
                : `SLA extended until ${expiresLabel || 'the extended deadline'}. A new request can be raised once the extension is within 12h of breaching.`;
              return (
                <span
                  aria-label={tooltip}
                  title={tooltip}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 8px', borderRadius: 6,
                    background: '#fff7ed',
                    color: '#9a3412',
                    border: '1px solid #fed7aa',
                    fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
                    cursor: 'default', fontFamily: 'inherit',
                  }}
                >
                  <i className={isPending ? 'bi-hourglass-split' : 'bi-clock-history'} style={{ fontSize: 9 }} />
                  {isPending ? 'Ext. requested' : 'Ext. active'}
                </span>
              );
            }
            return (
              <button
                type="button"
                onClick={() => onSlaExtension?.()}
                aria-label={`Request SLA extension for "${task.subject || task.id}"`}
                title="Request to extend the SLA on this task"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 8px', borderRadius: 6,
                  background: hov ? '#fff7ed' : '#f5f4f2',
                  color: hov ? '#d97706' : '#9e9e9e',
                  border: hov ? '1px solid #fed7aa' : '1px solid transparent',
                  fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <i className="bi-clock-history" style={{ fontSize: 9 }} />
                SLA Extension
              </button>
            );
          })()}
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

// ── ResizableSubjectTh ────────────────────────────────────────────────────
// Mirrors SortableTh's sort UI (click to toggle ▲/▼) but adds a 6 px
// drag handle pinned to the right edge that lets the user widen / narrow
// the Subject column. Reads its width from the table-level
// `--queue-subject-width` CSS variable (driven by the Queue component's
// state + drag handler) so the th + every QueueRow td stay in lockstep
// without prop-drilling. Skill rule #5: storage is email-scoped (the
// loader/saver live at module top).
const ResizableSubjectTh = memo(function ResizableSubjectTh({ sortCol, sortDir, onSort, onResizeStart }) {
  const active = sortCol === 'subject';
  const sortState = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  const [handleHov, setHandleHov] = useState(false);
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort('subject'); }
  };
  return (
    <th
      scope="col"
      role="columnheader"
      aria-sort={sortState}
      onClick={() => onSort('subject')}
      onKeyDown={onKey}
      tabIndex={0}
      style={{
        ...thStyle,
        width: 'var(--queue-subject-width, 480px)',
        minWidth: SUBJECT_WIDTH_MIN,
        textAlign: 'left',
        cursor: 'pointer',
        userSelect: 'none',
        position: 'relative',
      }}
      aria-label={`Sort by Subject${active ? `, currently ${sortState}` : ''}. Drag the right edge to resize the column.`}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        Subject
        <span aria-hidden="true" style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1, gap: 0, fontSize: 7, marginTop: -1 }}>
          <i className="bi-caret-up-fill" style={{ color: active && sortDir === 'asc' ? '#1b1b1b' : '#ccc' }} />
          <i className="bi-caret-down-fill" style={{ color: active && sortDir === 'desc' ? '#1b1b1b' : '#ccc', marginTop: -3 }} />
        </span>
        {/* Persistent resize-affordance icon next to the label so the user
            knows the column is widenable before they ever touch the right
            edge. Faint at rest; the hit-target lives on the right-edge
            handle below, not on this icon. */}
        <i
          className="bi-arrows"
          aria-hidden="true"
          title="Drag the right edge to resize"
          style={{ fontSize: 10, color: 'var(--text-muted)', opacity: handleHov ? 1 : 0.55, marginLeft: 2, transition: 'opacity .12s' }}
        />
      </span>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Subject column"
        title="Drag to resize"
        onMouseDown={onResizeStart}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onMouseEnter={() => setHandleHov(true)}
        onMouseLeave={() => setHandleHov(false)}
        style={{
          position: 'absolute',
          top: 0, right: 0, bottom: 0,
          width: 8,
          cursor: 'col-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingRight: 2,
        }}
      >
        {/* Persistent thin rail so the affordance is always visible — not
            just on hover. Thickens + flips to the brand accent when the
            user hovers, matching the cursor change. */}
        <span
          aria-hidden="true"
          style={{
            display: 'block',
            width: handleHov ? 3 : 2,
            height: handleHov ? '70%' : '55%',
            background: handleHov ? '#1f74b3' : 'var(--border)',
            borderRadius: 2,
            transition: 'width .12s, height .12s, background .12s',
          }}
        />
      </div>
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
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 200, minWidth: 260, maxHeight: 360, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {showSearch && (
            <div style={{ padding: '8px 10px', borderBottom: '1px solid #f2f2f2', display: 'flex', alignItems: 'center', gap: 6 }}>
              <i className="bi-search" style={{ fontSize: 11, color: 'var(--text-muted)' }}></i>
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); setOpen(false); } }}
                placeholder={`Search ${label.toLowerCase()}…`}
                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12, color: 'var(--text)', background: 'transparent' }}
              />
              {query && (
                <i className="bi-x-circle-fill" onClick={() => setQuery('')}
                  style={{ fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}></i>
              )}
            </div>
          )}
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
            {isActive && (
              <div onClick={() => { onChange([]); setOpen(false); setQuery(''); }}
                style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', borderBottom: '1px solid #f2f2f2', display: 'flex', alignItems: 'center', gap: 6 }}
                onMouseEnter={e => e.currentTarget.style.background = '#f9f8f6'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <i className="bi-x-circle" style={{ fontSize: 11 }}></i>Clear selection
              </div>
            )}
            {filtered.length === 0 && (
              <div style={{ padding: '16px 14px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
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
// Compressed paddings (2026-05-25) — matches SourceTable. Frees ~40-60px
// of horizontal space per row so the Actions column stays visible on
// common 1280-1440px viewports without a horizontal scrollbar.
const thStyle = { padding: '8px 6px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid #e8e8e8' };
const tdStyle = { padding: '8px 6px', textAlign: 'center', verticalAlign: 'middle' };

// ── Ticket note modal ─────────────────────────────────────────────────────
// Same shape as SourceTable's NoteModal, but reads task.subject / task.source
// from the ZD/Jira task descriptor. Personal notes saved to localStorage,
// keyed by `${source}:${id}` so they re-attach after every queue sync.
function TicketNoteModal({ task, initialText, maxLength, onSave, onDelete, onClose }) {
  const [text, setText] = useState(initialText || '');
  const textareaRef = useRef(null);

  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { onSave(text); }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose, onSave, text]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    try { el.setSelectionRange(len, len); } catch {}
  }, []);

  const hadNote = !!(initialText && initialText.trim());
  const sourceLabel = TOOLS[task.source]?.label || task.source;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 15, 15, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={hadNote ? 'Edit note' : 'Add note'}
        style={{
          width: 'min(520px, 100%)', background: 'var(--surface)', color: 'var(--text)',
          borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,.25)',
          border: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
          maxHeight: '85vh',
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 8, background: '#fef7e0', color: '#b7791f' }}>
              <i className="bi-sticky-fill" style={{ fontSize: 14 }} />
            </span>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
              {hadNote ? 'Edit note' : 'Add note'}
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, marginLeft: 36, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', borderRadius: 128, background: 'var(--surface-2)', fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
              {sourceLabel}
            </span>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }} title={task.subject}>
              {task.subject || task.id}
            </span>
          </div>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, maxLength))}
            placeholder="Add a personal note for this task. Only you can see it."
            rows={6}
            style={{
              width: '100%', minHeight: 140, padding: '10px 12px', borderRadius: 10,
              border: '1px solid var(--border)', background: 'var(--surface-2)',
              color: 'var(--text)', fontSize: 13, fontFamily: 'inherit',
              lineHeight: 1.45, outline: 'none', resize: 'vertical', boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
            <span>Saved on this device, keyed to this task&apos;s source + id.</span>
            <span>{text.length} / {maxLength}</span>
          </div>
        </div>

        <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
          {hadNote && (
            <button
              type="button"
              onClick={onDelete}
              style={{
                padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--surface)', color: '#d42d35', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit', marginRight: 'auto',
              }}
            >
              <i className="bi-trash" style={{ fontSize: 11, marginRight: 4 }} />
              Delete
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(text)}
            style={{
              padding: '8px 16px', borderRadius: 8, border: '1px solid var(--purple)',
              background: 'var(--purple)', color: 'white', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default Queue;
