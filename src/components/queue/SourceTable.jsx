// ── SourceTable ─────────────────────────────────────────────────────────────
// Unified table for all work sources (onboarding, offboarding, amendments,
// redlines, workbench, and the combined "All" view).
// Expects normalized rows with a common shape.
import { useState, useMemo, useRef, useEffect, useCallback, memo } from 'react';
import { TOOLS, getFlag, getCountryName } from '../../data/constants';
import Avatar from '../ui/Avatar';
import { useVirtualRows } from '../../hooks/useVirtualRows';
import { elapsedBizMs } from '../../utils/bizTime';
import {
  SUBJECT_WIDTH_MIN,
  clampSubjectWidth as clampSubjectWidthShared,
  loadStoredSubjectWidth,
  saveStoredSubjectWidth,
} from '../../lib/queue-subject-width';
import { useCurrentDept } from '../../hooks/useCurrentDept';
import { getHubBrand } from '../../lib/hub-brand';
import { useHideResolved } from '../../hooks/useHideResolved';
import { isSlaExtensionLocked } from '../../utils/applySlaExtensions';

// Subject column width — shared resize affordance with Queue.jsx (ZD/Jira).
// The Workbench bug Chaitanya Raju Uppalapati flagged 2026-05-22 ("Workbench
// Title should be extendable just like in workbench to be able to see the
// name of the Employee") applies to every Deel source that flows through
// this component. Different storage base than Queue.jsx so the wider
// Workbench column doesn't auto-balloon the ZD/Jira table (and vice versa);
// the CSS variable name `--queue-subject-width` is shared so styling stays
// uniform.
const SOURCE_SUBJECT_WIDTH_DEFAULT = 280;
const SOURCE_SUBJECT_WIDTH_STORAGE_BASE = 'ops_hub_source_subject_width';
const clampSourceSubjectWidth = (n) => clampSubjectWidthShared(n, SOURCE_SUBJECT_WIDTH_DEFAULT);

// Fixed row height for virtualization. Rows below `<SourceRow />` are
// locked to this height via inline style + `overflow:hidden` on cells so
// the windowing math stays accurate. 44px matches the existing visual
// rhythm (8px padding × 2 + ~28px content) without changing anything
// users see.
const ROW_HEIGHT = 44;

// ── Date formatters ──
function fmtDate(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  if (isNaN(d)) return '--';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function timeAgo(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  if (isNaN(d)) return '--';
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  const days = Math.floor(mins / 1440);
  return `${days}d ago`;
}

// Business-day elapsed minutes since `dateStr`. Saturday/Sunday don't tick,
// matching every other SLA pill in the app (computeSlaWindow / slaInfo).
// Returns null for missing or future timestamps so callers can fall through.
function bizMinutesSince(dateStr) {
  if (!dateStr) return null;
  const ts = new Date(dateStr).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.floor(elapsedBizMs(ts, Date.now()) / 60000);
}

function slaBadge(createdAt, thresholdDays = null) {
  // Fallback pill — only renders when a row has no `slaRemaining`. Uses
  // BUSINESS-DAY age so the rare miss-path agrees with the per-row biz-day
  // pill (WorkbenchSlaBadge) rest of the table draws. `thresholdDays` is a
  // biz-day threshold (offboarding: 14 term, 5 resig) — matches the
  // configured SLA window.
  const mins = bizMinutesSince(createdAt);
  if (mins == null || mins < 0) return null; // guard against future dates
  const days = Math.floor(mins / 1440);
  const hrs = Math.floor((mins % 1440) / 60);

  // Type-aware mode: caller passed an SLA threshold (offboarding: 14d terms, 5d resigs).
  // Breach = age >= threshold. At-risk = age >= 70% of threshold.
  if (thresholdDays != null && thresholdDays > 0) {
    const overdue = days - thresholdDays;
    if (overdue >= 0) {
      const label = overdue > 0 ? `+${overdue}d over` : `${days}d`;
      return { label, color: '#d42d35', bg: '#fef2f2', severity: 'breached' };
    }
    if (days >= Math.ceil(thresholdDays * 0.7)) {
      return { label: `${days}d`, color: '#ed8d00', bg: '#fff8e6', severity: 'at_risk' };
    }
    return { label: `${days}d`, color: '#1d4ed8', bg: '#eff6ff', severity: 'ok' };
  }

  // Generic thresholds (non-offboarding).
  if (days >= 7) return { label: `${days}d`, color: '#d42d35', bg: '#fef2f2', severity: 'breached' };
  if (days >= 3) return { label: `${days}d ${hrs}h`, color: '#ed8d00', bg: '#fff8e6', severity: 'at_risk' };
  if (days >= 1) return { label: `${days}d ${hrs}h`, color: '#1d4ed8', bg: '#eff6ff', severity: 'ok' };
  return { label: hrs > 0 ? `${hrs}h` : `${mins}m`, color: '#15803d', bg: '#e8f5e9', severity: 'ok' };
}

// ── Offboarding SLA + end-date urgency ──────────────────────────────────────
// Combines two urgency signals into a single tier + rank:
//   • SLA age (14 BIZ days for terminations, 5 BIZ days for resignations)
//   • End-date proximity (ASAP / past / within 3 days — calendar, since the
//     contract end date is a wall-clock anchor)
// Lower tier = more urgent. Within a tier, higher rank = more urgent.
//
// Reads the row's biz-day-derived SLA fields (slaBreachStatus / slaRemaining
// / slaWindowMs) populated by normalizeOffboarding so the sort tier matches
// the per-row pill exactly. Earlier code re-computed `(now - createdAt) / 86400000`
// on the calendar clock against a 14/5 calendar threshold — that disagreed
// with the biz-day pill on rows straddling weekends, e.g. a Friday row could
// sort to "breached" while still showing on-track in the badge.
function offboardingSlaThreshold(row) {
  return (row.typeLabel || '').startsWith('Resignation') ? 5 : 14;
}
function offboardingUrgency(row) {
  const now = Date.now();
  const createdMs = row.createdAt ? new Date(row.createdAt).getTime() : NaN;
  const ageDays = Number.isFinite(createdMs) ? (now - createdMs) / 86400000 : 0;

  const slaBreached = row?.slaBreachStatus === 'SLA_BREACHED'
    || (typeof row?.slaRemaining === 'number' && row.slaRemaining <= 0);
  const slaAtRisk = !slaBreached
    && typeof row?.slaRemaining === 'number'
    && row.slaRemaining > 0
    && Number.isFinite(row?.slaWindowMs) && row.slaWindowMs > 0
    && row.slaRemaining < (row.slaWindowMs / 1000) / 4;

  // "How far past breach" in days, used to rank the breached tiers. For
  // non-breached rows we fall back to wall-clock age (older first) — same
  // behaviour the original code produced inside the imminent / at-risk
  // tiers.
  const breachOverflowDays = slaBreached
    ? Math.max(0, -(typeof row?.slaRemaining === 'number' ? row.slaRemaining : 0)) / 86400
    : 0;

  const endMsRaw = row.endDate ? new Date(row.endDate).getTime() : NaN;
  const endMs = Number.isFinite(endMsRaw) ? endMsRaw : null;
  const endDays = endMs != null ? (endMs - now) / 86400000 : null;
  const endPast = endDays != null && endDays <= 0;
  const endImminent = endDays != null && endDays > 0 && endDays <= 3;
  const asap = endMs == null || row.endDateIsConfirmed === false;

  if (slaBreached && endPast)  return { tier: 0, rank: breachOverflowDays + Math.min(60, -endDays) };
  if (slaBreached)             return { tier: 1, rank: breachOverflowDays };
  if (endPast)                 return { tier: 2, rank: Math.min(60, -endDays) };
  if (endImminent)             return { tier: 3, rank: 3 - endDays };
  if (asap)                    return { tier: 4, rank: ageDays };
  if (slaAtRisk)               return { tier: 5, rank: ageDays };
  return                              { tier: 6, rank: -(endDays ?? 999) }; // normal: earliest end date first
}

// ── Generic SLA tier ────────────────────────────────────────────────────────
// 0 = breached, 1 = at-risk, 2 = on-track. Uses the same proportional band
// Queue.jsx applies (slaWindowMs / 4) so the per-row pill, the SLA pill
// counts, and this sort tie-break never disagree about which row is in
// which tier. Rows without slaRemaining fall into "on-track" so a sparse
// upstream payload sorts to the bottom rather than the top.
function slaTier(row) {
  // Resolved rows sit in their own "RESOLVED TODAY" section — the sort
  // tier is irrelevant for them (the section orders by recency, not by
  // SLA), but classifying as on-track keeps the SLA-column sort and the
  // header pill counts consistent.
  if (row?.isResolved) return 2;
  if (row?.slaBreachStatus === 'SLA_BREACHED') return 0;
  if (typeof row?.slaRemaining === 'number' && row.slaRemaining <= 0) return 0;
  if (typeof row?.slaRemaining === 'number' && row.slaRemaining > 0) {
    const windowSec = Number.isFinite(row.slaWindowMs) && row.slaWindowMs > 0
      ? row.slaWindowMs / 1000
      : 24 * 60 * 60;
    if (row.slaRemaining < windowSec / 4) return 1;
  }
  return 2;
}
function createdMs(row) {
  return row?.createdAt ? new Date(row.createdAt).getTime() : Number.POSITIVE_INFINITY;
}
// Default tie-break used by every non-SLA column sort: same SLA tier groups
// together, oldest within each tier. Spec: "Sort by country first, then
// organize the tasks based on SLA old to new."
function compareTierThenAge(a, b) {
  const ta = slaTier(a), tb = slaTier(b);
  if (ta !== tb) return ta - tb;
  return createdMs(a) - createdMs(b);
}

/**
 * SourceTable renders a flat table of normalized rows.
 *
 * Each row shape:
 * {
 *   id:        string,
 *   source:    'onboarding' | 'offboarding' | 'amendments' | 'redlines' | 'workbench',
 *   subject:   string,          // "Employee name — Start date"
 *   function:  string,          // e.g. "Compliance Docs · Awaiting Review"
 *   country:   string,          // code or name
 *   assignee:  string,
 *   createdAt: string,          // ISO date
 *   updatedAt: string,          // ISO date
 *   status:    { label, severity, color },
 *   taskUrl:   string,
 *   slaRemaining: number|null,  // seconds remaining (workbench tasks)
 *   slaBreachStatus: string,    // workbench SLA status
 * }
 */
export default function SourceTable({
  rows = [],
  loading = false,
  error = null,
  onRefresh,
  emptyIcon = 'bi-inbox',
  emptyLabel = 'No tasks found',
  emptySubLabel = 'All caught up',
  showSourceColumn = false,  // show Source column (for "All" view)
  searchable = true,
  sortDefault = 'oldest',    // 'oldest' | 'newest' | 'sla' | 'startDate' | 'endDate'
  showPausedSla = false,     // use 48h countdown from pausedAt instead of age-based SLA
  hideStatusPills = false,   // hide the internal All/Action Needed/etc. pills
  dateField = 'startDate',   // row field rendered in the date column
  dateLabel = 'Start Date',  // header label for the date column
  showClient = false,        // show "Organization" column (offboarding, etc.)
  showType = false,          // show "Type" column (Termination / Resignation — offboarding)
  hideFilterBar = false,     // hide the whole filter bar (pills + search + refresh + count) when redundant
  hideUpdated = false,       // hide the "Updated" column
  hideContract = false,      // hide the "Contract" column (redlines don't always have one)
  viewerEmail = '',          // signed-in user's email — splits the table into Mine vs Others
  onHide,                    // (row) => void — called when the row's Hide button is clicked
  onEscalate,                // (row) => void — called when the row's Escalate button is clicked
  onReassign,                // (row) => void — called when the row's Reassign button is clicked (Onb / Amend / Redline / IP only)
  onSlaExtension,            // (row) => void — called when the row's SLA Extension button is clicked
  onBulkHide,                // (rows[]) => void — bulk variant; enables checkboxes + bulk-bar Hide button
  onBulkEscalate,            // (rows[]) => void — bulk variant; enables checkboxes + bulk-bar Escalate button
  onBulkReassign,            // (rows[]) => void — bulk variant; enables checkboxes + bulk-bar Reassign button
  notesApi = null,           // useTaskNotes() return — enables the Note column when present
  subjectLabel = 'Employee', // 2026-05-22 — header label for the primary
                              // (resizable) column. Defaults to 'Employee'
                              // for every queue that lists workers; the
                              // Immigration Tasks panel overrides this to
                              // 'Task' since the column carries the task
                              // name ("Document upload" etc.) not a person.
  clientLabel = 'Organization', // 2026-05-22 — header label for the
                              // secondary "client" column (shown when
                              // showClient is true). Immigration Tasks
                              // panel overrides to 'Applicant · Case'
                              // because the column now carries triage
                              // info ("Pearce Dolan · Right to Work")
                              // instead of the customer org name.
  sourceKey = '',            // 2026-05-28 — identifier (e.g. 'workbench')
                              // used as a localStorage namespace for the
                              // OTHERS-collapse preference. Empty key
                              // disables persistence (in-session state
                              // only, no surface change for callers that
                              // don't supply it).
  othersCollapsible = false, // when true, the OTHERS section header
                              // becomes a click-target that toggles
                              // visibility of its row body. Keep this
                              // off for sources where the Others bucket
                              // IS the country pipeline (Onb/Off/Amend/
                              // Redline) — those managers triage Others
                              // as primary work and shouldn't have to
                              // expand it every time.
  othersDefaultCollapsed = false, // initial collapse state when the user
                              // has no stored preference. Set true for
                              // Workbench so country-fallback orphans
                              // don't dominate the personal queue view.
}) {
  // 2026-05-22 — dept-branded escalation button. The "Escalate to HR Hub"
  // tooltip becomes "Escalate to GIX Hub" / "Escalate to Benefits Hub" / …
  // for users in those depts. See src/lib/hub-brand.js.
  const deptState = useCurrentDept();
  const hubBrand = useMemo(() => getHubBrand(deptState.dept), [deptState.dept]);
  // 2026-05-22 — Celine Taruc request: persistent "hide resolved" toggle.
  // Shares the localStorage key with Queue.jsx (`ops_hub_hide_resolved:<email>`)
  // so toggling from either surface flips both. Re-render flows through
  // the hook's useState — the BroadcastChannel sync isn't required because
  // both consumers re-mount when the queue source tab changes.
  const { hideResolved, toggleHideResolved } = useHideResolved(viewerEmail);
  // ── User-resizable Subject column ────────────────────────────────────────
  // Mirrors the ZD/Jira Queue resize (see Queue.jsx for the parent comment).
  // State holds the React-visible width (drives the table's inline CSS
  // variable on next render); `subjectWidthRef` carries the in-flight value
  // during a drag so onmousemove can update the DOM directly without going
  // through React; `tableElRef` lets the drag handler reach the <table> to
  // set the variable per frame. The same variable name is used in Queue.jsx
  // so the th + td share styling tokens (storage keys are separate so each
  // table keeps its own width).
  const [subjectWidth, setSubjectWidth] = useState(() => loadStoredSubjectWidth(SOURCE_SUBJECT_WIDTH_STORAGE_BASE, viewerEmail, SOURCE_SUBJECT_WIDTH_DEFAULT));
  const subjectWidthRef = useRef(subjectWidth);
  useEffect(() => { subjectWidthRef.current = subjectWidth; }, [subjectWidth]);
  const tableElRef = useRef(null);
  // Re-load if the signed-in email changes mid-session (impersonation +
  // login-as-dept-admin swap `viewerEmail` without a remount).
  useEffect(() => {
    setSubjectWidth(loadStoredSubjectWidth(SOURCE_SUBJECT_WIDTH_STORAGE_BASE, viewerEmail, SOURCE_SUBJECT_WIDTH_DEFAULT));
  }, [viewerEmail]);
  const handleSubjectResizeStart = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = subjectWidthRef.current;
    const onMove = (mv) => {
      const next = clampSourceSubjectWidth(startWidth + (mv.clientX - startX));
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
      saveStoredSubjectWidth(SOURCE_SUBJECT_WIDTH_STORAGE_BASE, viewerEmail, final);
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [viewerEmail]);

  // Note modal state — opened from any row's Note button. One modal per
  // table; the active row is held here so SourceRow stays stateless.
  const [noteModalRow, setNoteModalRow] = useState(null);
  const hasNotes = !!notesApi;
  // Selection state — opt-in. Only mounts the checkbox column + bulk-bar
  // when the parent passes at least one bulk handler. Selection key = row.id
  // (already string-coerced by every normalizer); sticky across re-renders
  // but cleared when the source-set changes (see effect below) so a newly-
  // synced refresh doesn't carry stale ids selected.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const canBulk = !!(onBulkHide || onBulkEscalate || onBulkReassign);
  const clearSelection = () => setSelectedIds(new Set());
  const toggleRowSelection = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const [searchTerm, setSearchTerm] = useState('');
  // Default sort = SLA tier oldest-first across every panel — the per-PR-2
  // spec ("All Qs default sort should be by SLA old to new"). Callers can
  // still override via sortDefault prop, but this keeps the unified default.
  const defaultCol = sortDefault === 'endDate' ? 'endDate'
    : sortDefault === 'startDate' ? 'startDate'
    : sortDefault === 'createdAt' ? 'createdAt'
    : 'sla';
  const defaultDir = sortDefault === 'newest' ? 'desc' : 'asc';
  const [sortCol, setSortCol] = useState(defaultCol);
  const [sortDir, setSortDir] = useState(defaultDir); // 'asc' | 'desc'
  const [statusFilter, setStatusFilter] = useState(null);

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  // Filter
  const filtered = useMemo(() => {
    let r = rows;
    if (statusFilter) {
      // Severity pills are active-state only — pill counts exclude resolved
      // (see `counts` memo above), so the filter must drop resolved rows too
      // or clicking "In Progress N" would surface > N rows when a workbench
      // task closed today still carries the In Progress severity stamp.
      r = r.filter(row => !row?.isResolved && row.status?.severity === statusFilter);
    }
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      // Every field is String-coerced before .toLowerCase() — live audit
      // 2026-05-11 caught a crash when an onboarding row carried a numeric
      // `id` and `(row.id || '').toLowerCase()` threw "toLowerCase is not
      // a function". Defensive coercion across the lot so any future
      // upstream that ships a number / boolean / null doesn't take the
      // whole queue down.
      const lc = (v) => String(v == null ? '' : v).toLowerCase();
      r = r.filter(row =>
        lc(row.subject).includes(q) ||
        lc(row.function).includes(q) ||
        lc(row.country).includes(q) ||
        lc(row.assignee).includes(q) ||
        lc(row.clientName).includes(q) ||
        lc(row.typeLabel).includes(q) ||
        lc(row.id).includes(q)
      );
    }
    return r;
  }, [rows, searchTerm, statusFilter]);

  // Sort by column + direction.
  // Spec rule: when the user picks a non-SLA column, primary sort is that
  // column; secondary sort is SLA tier (Breached → At-Risk → On Track) with
  // the oldest row first inside each tier. Default SLA sort is the same
  // tier+oldest rule. For offboarding the SLA column keeps the smart end-
  // date weighting (offboardingUrgency) since end-date proximity is part
  // of the queue's idiomatic SLA. asc click flips to desc on second click.
  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'desc' ? -1 : 1;

    // SLA column sort
    if (sortCol === 'sla') {
      const isOffboardingSla = arr.some(r => r.source === 'offboarding');
      if (isOffboardingSla) {
        return arr.sort((a, b) => {
          const au = a.source === 'offboarding' ? offboardingUrgency(a) : { tier: 99, rank: 0 };
          const bu = b.source === 'offboarding' ? offboardingUrgency(b) : { tier: 99, rank: 0 };
          if (au.tier !== bu.tier) return (au.tier - bu.tier) * dir;
          return (bu.rank - au.rank) * dir; // higher rank = more urgent
        });
      }
      // Generic queues — tier + oldest, flipped by direction.
      return arr.sort((a, b) => compareTierThenAge(a, b) * dir);
    }

    const getVal = (row) => {
      switch (sortCol) {
        case 'subject':   return (row.subject || '').toLowerCase();
        case 'clientName':return (row.clientName || '').toLowerCase();
        case 'typeLabel': return (row.typeLabel || '').toLowerCase();
        case 'country':   return (row.country || '').toLowerCase();
        case 'assignee':  return (row.assignee || '').toLowerCase();
        case 'startDate': return row.startDate ? new Date(row.startDate).getTime() : Infinity;
        case 'endDate':   return row.endDate ? new Date(row.endDate).getTime() : Infinity;
        case 'createdAt': return row.createdAt ? new Date(row.createdAt).getTime() : Infinity;
        case 'updatedAt': return row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
        case 'status':    return (row.status?.label || '').toLowerCase();
        default: return 0;
      }
    };

    return arr.sort((a, b) => {
      const aVal = getVal(a);
      const bVal = getVal(b);
      if (aVal < bVal) return -1 * dir;
      if (aVal > bVal) return 1 * dir;
      // Tie-break on the SLA tier + age — keeps grouped sorts (Country,
      // Status, Assignee, etc.) ordered by urgency within each group so a
      // "by country" view still surfaces the oldest breached rows first
      // inside each country bucket.
      return compareTierThenAge(a, b);
    });
  }, [filtered, sortCol, sortDir]);

  // Status counts — exclude resolved rows because the severity pills are an
  // active-state band (Critical / Action Needed / In Progress / Other). A
  // workbench task that finished today still carries its last severity
  // marker; counting it under "In Progress" would re-inflate the very
  // backlog the user just cleared.
  const counts = useMemo(() => {
    const c = { total: 0, critical: 0, warning: 0, active: 0, info: 0 };
    for (const r of rows) {
      if (r?.isResolved) continue;
      c.total++;
      const sev = r.status?.severity;
      if (sev && c[sev] !== undefined) c[sev]++;
    }
    return c;
  }, [rows]);

  // Partition the sorted list into Mine vs Others, then split each into
  // Active vs Paused vs Resolved. "Mine" = rows whose assigneeEmail
  // matches the viewer (real or synthetic-from-country-owner). When the
  // viewer has no rows of their own (admin / RM looking at a region they
  // don't personally own, or pre-auth) the Mine sections collapse and we
  // render a single Active + Paused + Resolved stack like before. Resolved
  // covers Workbench's 24h COMPLETED + CLOSED window — they're rendered
  // under their own "RESOLVED TODAY" band so they read as "done", not
  // mixed into the active backlog.
  const viewerEmailLc = (viewerEmail || '').toLowerCase();
  const { mineActive, minePaused, mineResolved, othersActive, othersPaused, othersResolved } = useMemo(() => {
    const mA = [], mP = [], mR = [], oA = [], oP = [], oR = [];
    for (const r of sorted) {
      const isMine = !!viewerEmailLc && (r.assigneeEmail || '').toLowerCase() === viewerEmailLc;
      const bucket = r?.isResolved
        ? (isMine ? mR : oR)
        : r?.isPaused
          ? (isMine ? mP : oP)
          : (isMine ? mA : oA);
      bucket.push(r);
    }
    return { mineActive: mA, minePaused: mP, mineResolved: mR, othersActive: oA, othersPaused: oP, othersResolved: oR };
  }, [sorted, viewerEmailLc]);

  const hasMineSection = mineActive.length + minePaused.length + mineResolved.length > 0;

  // ── OTHERS collapse state (2026-05-28 — Raquel feedback) ─────────────────
  // Workbench's Others bucket is country-fallback orphan rows that inflate
  // the visible row count without representing personal work. Collapsing
  // the section by default keeps the orphans discoverable (header + count
  // still render, expand-on-click) but lets the personal queue read clean.
  // Persisted per-user-per-source so a manager who DOES want to triage
  // Others all the time can expand it once and have it stick.
  const othersCollapseKey = useMemo(() => {
    if (!othersCollapsible || !sourceKey || !viewerEmail) return null;
    return `ops_hub_source_others_collapsed:${String(viewerEmail).toLowerCase()}:${sourceKey}`;
  }, [othersCollapsible, sourceKey, viewerEmail]);
  const [othersCollapsed, setOthersCollapsed] = useState(() => {
    if (!othersCollapsible) return false;
    if (!othersCollapseKey) return othersDefaultCollapsed;
    try {
      const stored = localStorage.getItem(othersCollapseKey);
      if (stored === '0') return false;
      if (stored === '1') return true;
    } catch { /* private mode / quota — silent */ }
    return othersDefaultCollapsed;
  });
  const toggleOthersCollapsed = useCallback(() => {
    setOthersCollapsed(prev => {
      const next = !prev;
      if (othersCollapseKey) {
        try { localStorage.setItem(othersCollapseKey, next ? '1' : '0'); } catch { /* silent */ }
      }
      return next;
    });
  }, [othersCollapseKey]);

  // Selection bookkeeping derived from the filtered+sorted view. Selecting
  // "All" only affects rows the user can currently see (respects search +
  // status filter). Drop selection of rows that disappear from the view
  // (e.g. status filter narrows, row hidden upstream) so a stale id can't
  // get picked up later by toggleAllVisible / bulk action.
  const visibleIds = useMemo(() => sorted.map(r => String(r.id)), [sorted]);
  const visibleIdSet = useMemo(() => new Set(visibleIds), [visibleIds]);
  useEffect(() => {
    if (!canBulk || selectedIds.size === 0) return;
    let dirty = false;
    const next = new Set();
    for (const id of selectedIds) {
      if (visibleIdSet.has(id)) next.add(id); else dirty = true;
    }
    if (dirty) setSelectedIds(next);
    // Cheap guard: only re-run when the visible set or the selection changes.
  }, [visibleIdSet, selectedIds, canBulk]);
  const visibleSelectedCount = useMemo(() => {
    if (selectedIds.size === 0) return 0;
    let n = 0;
    for (const id of visibleIds) if (selectedIds.has(id)) n++;
    return n;
  }, [visibleIds, selectedIds]);
  const allVisibleSelected = visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected;
  const toggleAllVisible = () => {
    setSelectedIds(prev => {
      // If everything visible is already selected, deselect those — but
      // keep selections for rows outside the current view.
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  };
  // Build the actual row objects for the bulk action handlers — the parent
  // wants the full row, not just ids, so it can read taskUrl / subject /
  // country without re-walking the rows array.
  const selectedRows = useMemo(() => {
    if (selectedIds.size === 0) return [];
    return sorted.filter(r => selectedIds.has(String(r.id)));
  }, [sorted, selectedIds]);

  // Flatten into a single virtual list. Section ordering:
  //   1. Mine — Active   (header "MINE" when there are also Others/Paused sections)
  //   2. Mine — Paused   (header "MINE — PAUSED" only when minePaused exists)
  //   3. Others — Active (header "OTHERS" only when there's a Mine section above)
  //   4. Others — Paused (header "OTHERS — PAUSED" or "PAUSED" if no Mine)
  // The 2026-05-01 agent audit found that the Mine — Active block lacked
  // any heading while Mine — Paused and Others were both labeled, leaving
  // an unbalanced visual hierarchy ("OTHERS (12)" appeared without a
  // matching "MINE (3)" above the active rows). Add the symmetric header
  // when there's anything below the Mine-active block to anchor against.
  // Each kind: 'header' | 'row' renders at ROW_HEIGHT so the windowing
  // math stays arithmetic.
  const virtualItems = useMemo(() => {
    const out = [];
    const hasAnythingBelowMine =
      minePaused.length > 0 || mineResolved.length > 0 ||
      othersActive.length > 0 || othersPaused.length > 0 || othersResolved.length > 0;
    if (mineActive.length > 0 && hasAnythingBelowMine) {
      out.push({ kind: 'header', tone: 'mine', label: 'MINE', count: mineActive.length });
    }
    for (const r of mineActive) out.push({ kind: 'row', row: r });
    if (minePaused.length > 0) {
      out.push({ kind: 'header', tone: 'paused', label: hasMineSection ? 'MINE — PAUSED' : 'PAUSED', count: minePaused.length });
      for (const r of minePaused) out.push({ kind: 'row', row: r });
    }
    // 2026-05-28: the OTHERS header is collapsible when the caller opted
    // in. When collapsed, the header still renders with the row count +
    // chevron, but the OTHERS rows + the "OTHERS — PAUSED" sub-band are
    // omitted from the virtual list so they don't take any space.
    if (othersActive.length > 0) {
      if (hasMineSection) {
        out.push({
          kind: 'header', tone: 'others', label: 'OTHERS',
          count: othersActive.length + othersPaused.length,
          collapsible: othersCollapsible,
          collapsed: othersCollapsible && othersCollapsed,
        });
      }
      if (!(othersCollapsible && othersCollapsed)) {
        for (const r of othersActive) out.push({ kind: 'row', row: r });
      }
    }
    if (othersPaused.length > 0 && !(othersCollapsible && othersCollapsed)) {
      out.push({ kind: 'header', tone: 'paused', label: hasMineSection ? 'OTHERS — PAUSED' : 'PAUSED', count: othersPaused.length });
      for (const r of othersPaused) out.push({ kind: 'row', row: r });
    }
    // Resolved sits at the very bottom — a single "RESOLVED TODAY" band that
    // spans both Mine and Others. Splitting it would dilute the signal (an
    // agent doesn't need to scan "who else closed something") and matches
    // the Zendesk queue's single bottom resolved section.
    // 2026-05-22 — `hideResolved` (per-user) suppresses the band; the count
    // chip in the filter row still surfaces the resolved tally so the
    // toggle has visible affordance.
    const resolvedCount = mineResolved.length + othersResolved.length;
    if (!hideResolved && resolvedCount > 0) {
      out.push({ kind: 'header', tone: 'resolved', label: 'RESOLVED TODAY', count: resolvedCount });
      for (const r of mineResolved) out.push({ kind: 'row', row: r });
      for (const r of othersResolved) out.push({ kind: 'row', row: r });
    }
    return out;
  }, [mineActive, minePaused, mineResolved, othersActive, othersPaused, othersResolved, hasMineSection, hideResolved, othersCollapsible, othersCollapsed]);

  const scrollerRef = useRef(null);
  const { startIdx, endIdx, topPad, bottomPad } = useVirtualRows({
    rowCount: virtualItems.length,
    rowHeight: ROW_HEIGHT,
    overscan: 8,
    scrollerRef,
  });
  const visibleItems = virtualItems.slice(startIdx, endIdx);

  // Column count for the "PAUSED" section header — needs to match the
  // active <thead> exactly so the band spans the table width regardless of
  // which optional columns the panel toggles on/off.
  const sectionColSpan = 1 // Subject (always)
    + (showSourceColumn ? 1 : 0)
    + (showClient ? 1 : 0)
    + (showType ? 1 : 0)
    + 4 // Country + Assignee + dateField + SLA
    + (hideUpdated ? 0 : 1)
    + 1 // Status
    + 1 // Task
    + (hideContract ? 0 : 1)
    + (hasNotes ? 1 : 0) // Note column when the parent wires the notes hook
    + ((onHide || onEscalate || onReassign || onSlaExtension) ? 1 : 0) // Actions column when the parent provides any row action
    + (canBulk ? 1 : 0); // Selection checkbox column when any bulk handler is wired

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--surface-2)', overflow: 'hidden' }}>
      {/* ── Filter bar ── */}
      {!hideFilterBar && (
      <div style={{ padding: '10px 24px', background: 'var(--surface)', borderBottom: '1px solid #f0efed', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {!hideStatusPills && <>
          <StatusPill label="All" count={counts.total} active={!statusFilter} onClick={() => setStatusFilter(null)} color="#1b1b1b" />
          {counts.critical > 0 && <StatusPill label="Critical" count={counts.critical} active={statusFilter === 'critical'} onClick={() => setStatusFilter(statusFilter === 'critical' ? null : 'critical')} color="#d42d35" />}
          {counts.warning > 0 && <StatusPill label="Action Needed" count={counts.warning} active={statusFilter === 'warning'} onClick={() => setStatusFilter(statusFilter === 'warning' ? null : 'warning')} color="#ed8d00" />}
          {counts.active > 0 && <StatusPill label="In Progress" count={counts.active} active={statusFilter === 'active'} onClick={() => setStatusFilter(statusFilter === 'active' ? null : 'active')} color="#1d4ed8" />}
          {counts.info > 0 && <StatusPill label="Other" count={counts.info} active={statusFilter === 'info'} onClick={() => setStatusFilter(statusFilter === 'info' ? null : 'info')} color="#616161" />}
        </>}

        <div style={{ flex: 1 }} />

        {searchable && (
          <div style={{ position: 'relative' }}>
            <i className="bi-search" aria-hidden="true" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text-muted)' }} />
            <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search..."
              role="searchbox"
              aria-label="Search tasks"
              style={{ width: 200, height: 32, paddingLeft: 30, paddingRight: 10, borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, outline: 'none' }} />
          </div>
        )}


        {onRefresh && (
          <button onClick={onRefresh} title="Refresh" aria-label={loading ? 'Refreshing tasks' : 'Refresh tasks'} style={{ ...iconBtnStyle, color: loading ? '#ed8d00' : '#9e9e9e' }}>
            <i className={loading ? 'bi-arrow-clockwise spin' : 'bi-arrow-clockwise'} aria-hidden="true" style={{ fontSize: 12 }} />
          </button>
        )}

        <span aria-live="polite" aria-atomic="true" style={{ fontSize: 11, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {(() => {
            const resolvedN = mineResolved.length + othersResolved.length;
            const activeN = sorted.length - resolvedN;
            if (resolvedN > 0) {
              return <span>{activeN} active · <span style={{ color: '#29811e' }}>{resolvedN} resolved</span></span>;
            }
            return <span>{`${sorted.length} ${sorted.length === 1 ? 'task' : 'tasks'}`}</span>;
          })()}
          {/* 2026-05-22 — Celine Taruc request: eye toggle to hide the
              RESOLVED TODAY band on the Workbench / Deel source panels.
              Mirrors the toggle in the parent Queue header so a user
              flipping it on one queue sees consistent state across the
              workspace. Only renders when there's a resolved tail to
              hide. */}
          {(mineResolved.length + othersResolved.length) > 0 && (
            <button
              type="button"
              onClick={toggleHideResolved}
              aria-pressed={hideResolved}
              title={hideResolved ? 'Show resolved tasks' : 'Hide resolved tasks'}
              style={{
                padding: '2px 6px', borderRadius: 6,
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
      </div>
      )}

      {/* ── Bulk action bar — appears whenever ≥1 row is selected.
           Sits between the filter bar and the table so it can scroll with
           neither (sticky to the top of the source-panel). Buttons only
           render for actions whose handler is provided by the parent, so
           any future bulk action drops in by adding a new prop. */}
      {canBulk && selectedIds.size > 0 && (
        <div role="toolbar" aria-label={`${selectedIds.size} tasks selected`}
          style={{
            padding: '10px 24px', background: '#1b1b1b', color: 'white',
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            position: 'sticky', top: 0, zIndex: 3,
          }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>
            {selectedIds.size} {selectedIds.size === 1 ? 'task' : 'tasks'} selected
          </span>
          <div style={{ flex: 1 }} />
          {onBulkEscalate && (
            <button type="button" onClick={() => onBulkEscalate(selectedRows)}
              style={bulkBtnStyle('#7c3aed')}>
              <i className="bi-arrow-up-right-circle" style={{ fontSize: 11 }} />
              Escalate {selectedIds.size}
            </button>
          )}
          {onBulkReassign && (
            <button type="button" onClick={() => onBulkReassign(selectedRows)}
              style={bulkBtnStyle('#1d4ed8')}>
              <i className="bi-arrow-left-right" style={{ fontSize: 11 }} />
              Reassign {selectedIds.size}
            </button>
          )}
          {onBulkHide && (
            <button type="button" onClick={() => onBulkHide(selectedRows)}
              style={bulkBtnStyle('#d42d35')}>
              <i className="bi-eye-slash" style={{ fontSize: 11 }} />
              Hide {selectedIds.size}
            </button>
          )}
          <button type="button" onClick={clearSelection}
            style={{ background: 'transparent', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Clear
          </button>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && rows.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <i className="bi-arrow-clockwise spin" style={{ fontSize: 28, color: 'var(--text-muted)', display: 'block', marginBottom: 12 }} />
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Loading tasks...</div>
        </div>
      )}

      {/* ── Error ── */}
      {error && rows.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <i className="bi-exclamation-triangle" style={{ fontSize: 40, color: '#ed8d00', display: 'block', marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Failed to load</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, maxWidth: 480 }}>{error}</div>
          {onRefresh && (
            <button onClick={onRefresh} style={{ padding: '8px 20px', borderRadius: 128, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--text)' }}>
              <i className="bi-arrow-clockwise" style={{ marginRight: 6 }} />Retry
            </button>
          )}
        </div>
      )}

      {/* ── Empty ── */}
      {!loading && !error && sorted.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <i className={emptyIcon} style={{ fontSize: 40, color: '#c0c0c0', display: 'block', marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
            {searchTerm || statusFilter ? 'No matches' : emptyLabel}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {searchTerm || statusFilter ? 'Try adjusting the filters' : emptySubLabel}
          </div>
        </div>
      )}

      {/* ── Table ── */}
      {sorted.length > 0 && (
        <div ref={scrollerRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
          <table
            ref={tableElRef}
            style={{
              width: '100%', borderCollapse: 'collapse', fontSize: 13,
              // Inline CSS variable consumed by the Subject <th> + the
              // Subject <td> in SourceRow. Mutated directly via tableElRef
              // during drag for instant resizing without re-rendering every
              // virtualized row.
              '--queue-subject-width': `${subjectWidth}px`,
            }}
          >
            <thead>
              <tr style={{ background: 'var(--surface-2)', position: 'sticky', top: 0, zIndex: 2 }}>
                {canBulk && (
                  <th style={{ ...thStyle, width: 36, padding: '8px 12px' }}>
                    <input
                      type="checkbox"
                      aria-label={allVisibleSelected ? 'Deselect all visible tasks' : 'Select all visible tasks'}
                      checked={allVisibleSelected}
                      ref={el => { if (el) el.indeterminate = someVisibleSelected; }}
                      onChange={toggleAllVisible}
                      style={{ cursor: 'pointer', width: 14, height: 14, accentColor: '#1d4ed8' }}
                    />
                  </th>
                )}
                {showSourceColumn && <th style={{ ...thStyle, width: 64 }}>Source</th>}
                <ResizableSubjectTh
                  sortCol={sortCol}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  onResizeStart={handleSubjectResizeStart}
                  subjectLabel={subjectLabel}
                />
                {showClient && <SortTh col="clientName" label={clientLabel} sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} style={{ ...thStyle, textAlign: 'left', minWidth: 110, maxWidth: 140 }} />}
                {showType && <SortTh col="typeLabel" label="Type" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} style={{ ...thStyle, width: 78 }} />}
                <SortTh col="country"   label="Country"    sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} style={{ ...thStyle, width: 68 }} />
                <SortTh col="assignee"  label="Assignee"   sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} style={{ ...thStyle, width: 80 }} />
                <SortTh col={dateField} label={dateLabel} sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} style={{ ...thStyle, width: 72 }} />
                <SortTh col="sla"       label="SLA"        sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} style={{ ...thStyle, width: 54 }} />
                {!hideUpdated && <SortTh col="updatedAt" label="Updated"    sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} style={{ ...thStyle, width: 60 }} />}
                <SortTh col="status"    label="Status"     sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} style={{ ...thStyle, width: 96 }} />
                <th style={{ ...thStyle, width: 48 }}>Task</th>
                {!hideContract && <th style={{ ...thStyle, width: 48 }}>Contract</th>}
                {hasNotes && <th style={{ ...thStyle, width: 44 }} title="Personal notes — saved to your browser, keyed by the task's source+id">Note</th>}
                {(onHide || onEscalate || onReassign || onSlaExtension) && <th style={{ ...thStyle, width: 212 }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {/* Virtual top spacer — preserves scroll position for the
                  rows we skipped. Setting `height` on a <td colSpan> keeps
                  the table layout intact (browsers measure spacer rows
                  before laying out the visible ones). */}
              {topPad > 0 && (
                <tr style={{ height: topPad }} aria-hidden="true">
                  <td colSpan={sectionColSpan} style={{ padding: 0, height: topPad }} />
                </tr>
              )}
              {visibleItems.map((it, i) => {
                if (it.kind === 'header') {
                  // Two tones — paused (existing brown band) vs others
                  // (slightly lighter, neutral grey). Same 44px height so
                  // the virtualizer math stays uniform.
                  const isPausedHeader = it.tone === 'paused';
                  const isMineHeader = it.tone === 'mine';
                  const isResolvedHeader = it.tone === 'resolved';
                  // 4-tone palette: Paused (warm brown), Mine (subtle blue —
                  // emphasizes the rows the viewer owns), Resolved (green —
                  // mirrors the ticket queue's "RESOLVED TODAY" band so the
                  // Workbench source reads visually identical to Zendesk),
                  // Others (neutral grey). Each band rests at ROW_HEIGHT so
                  // the virtualizer's arithmetic stays uniform.
                  const headerStyle = isResolvedHeader
                    ? { color: '#29811e', background: '#f9faf8', icon: 'bi-check-circle' }
                    : isPausedHeader
                      ? { color: '#6b6560', background: '#faf9f7', icon: 'bi-pause-circle-fill' }
                      : isMineHeader
                        ? { color: '#1d4ed8', background: '#eff6ff', icon: 'bi-person-check-fill' }
                        : { color: '#6b6560', background: 'var(--surface-2)', icon: 'bi-people' };
                  const isCollapsible = !!it.collapsible;
                  const isCollapsed = !!it.collapsed;
                  return (
                    <tr key={`section-band-${startIdx + i}`} style={{ height: ROW_HEIGHT }}>
                      <td
                        colSpan={sectionColSpan}
                        onClick={isCollapsible ? toggleOthersCollapsed : undefined}
                        role={isCollapsible ? 'button' : undefined}
                        tabIndex={isCollapsible ? 0 : undefined}
                        onKeyDown={isCollapsible ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleOthersCollapsed(); }
                        } : undefined}
                        title={isCollapsible ? (isCollapsed ? 'Click to show others' : 'Click to hide others') : undefined}
                        style={{
                          padding: '12px 16px', fontSize: 11, fontWeight: 700,
                          color: headerStyle.color, letterSpacing: '.04em',
                          background: headerStyle.background,
                          borderTop: '1px solid #e8e8e8', borderBottom: '1px solid #e8e8e8',
                          cursor: isCollapsible ? 'pointer' : undefined,
                          userSelect: isCollapsible ? 'none' : undefined,
                        }}
                      >
                        <i className={headerStyle.icon} style={{ fontSize: 11, marginRight: 6 }} />
                        {it.label} ({it.count})
                        {isCollapsible && (
                          <i
                            className={`bi ${isCollapsed ? 'bi-chevron-down' : 'bi-chevron-up'}`}
                            aria-hidden="true"
                            style={{ fontSize: 11, marginLeft: 8, opacity: 0.8 }}
                          />
                        )}
                        {isCollapsible && isCollapsed && (
                          <span style={{ marginLeft: 8, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>
                            — hidden, click to show
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                }
                const row = it.row;
                const noteHas = hasNotes ? notesApi.hasNote(row.source, row.id) : false;
                return (
                  <SourceRow
                    key={`${row.source}-${row.id}`}
                    row={row}
                    showSource={showSourceColumn}
                    showPausedSla={showPausedSla}
                    dateField={dateField}
                    showClient={showClient}
                    showType={showType}
                    hideUpdated={hideUpdated}
                    hideContract={hideContract}
                    onHide={onHide ? () => onHide(row) : null}
                    onEscalate={onEscalate ? () => onEscalate(row) : null}
                    onReassign={onReassign ? () => onReassign(row) : null}
                    onSlaExtension={onSlaExtension ? () => onSlaExtension(row) : null}
                    isSelectable={canBulk}
                    isSelected={canBulk && selectedIds.has(String(row.id))}
                    onToggleSelection={canBulk ? () => toggleRowSelection(String(row.id)) : null}
                    showNoteColumn={hasNotes}
                    hasNote={noteHas}
                    onOpenNote={hasNotes ? () => setNoteModalRow(row) : null}
                    escalateLabel={hubBrand.escalateLabel}
                  />
                );
              })}
              {bottomPad > 0 && (
                <tr style={{ height: bottomPad }} aria-hidden="true">
                  <td colSpan={sectionColSpan} style={{ padding: 0, height: bottomPad }} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Note editor modal — single instance per table; the active row
          identifies which note to load/save. Notes are user-scoped + keyed
          by `${source}:${row.id}` so they re-attach after every queue sync. */}
      {noteModalRow && notesApi && (
        <NoteModal
          row={noteModalRow}
          initialText={notesApi.getNote(noteModalRow.source, noteModalRow.id)}
          maxLength={notesApi.maxLength}
          onSave={(text) => { notesApi.setNote(noteModalRow.source, noteModalRow.id, text); setNoteModalRow(null); }}
          onDelete={() => { notesApi.removeNote(noteModalRow.source, noteModalRow.id); setNoteModalRow(null); }}
          onClose={() => setNoteModalRow(null)}
        />
      )}
    </div>
  );
}

// ── Note editor modal ──────────────────────────────────────────────────────
// Centered overlay with textarea + Save / Delete / Cancel buttons. Esc
// closes; Cmd/Ctrl+Enter saves. The text is bounded by `maxLength` from the
// hook so a single note can't blow the storage quota. Uses CSS vars for
// surface/text/border so the panel works in light + dark themes.
function NoteModal({ row, initialText, maxLength, onSave, onDelete, onClose }) {
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
    // Focus + place caret at the end for fast continuation.
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    try { el.setSelectionRange(len, len); } catch {}
  }, []);

  const hadNote = !!(initialText && initialText.trim());
  const tool = TOOLS[row.source];
  const sourceLabel = tool?.label || row.source;

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
        {/* Header */}
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
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }} title={row.subject}>
              {row.subject || row.id}
            </span>
          </div>
        </div>

        {/* Body */}
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
            <span>Saved on this device, keyed to this task's source + id.</span>
            <span>{text.length} / {maxLength}</span>
          </div>
        </div>

        {/* Footer */}
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

// ── Row component ──
const SourceRow = memo(function SourceRow({ row, showSource, showPausedSla = false, dateField = 'startDate', showClient = false, showType = false, hideUpdated = false, hideContract = false, onHide = null, onEscalate = null, onReassign = null, onSlaExtension = null, isSelectable = false, isSelected = false, onToggleSelection = null, showNoteColumn = false, hasNote = false, onOpenNote = null, escalateLabel = 'Escalate to HR Hub' }) {
  const [hov, setHov] = useState(false);
  const sev = row.status?.severity || 'info';
  const isUrgent = sev === 'critical';
  const isWarning = sev === 'warning';
  const rowBg = isUrgent ? '#fffbfb' : isWarning ? '#fffdf5' : 'white';
  // Offboarding gets type-aware SLA: Termination 14d, Resignation 5d.
  const slaThresholdDays = row.source === 'offboarding' ? offboardingSlaThreshold(row) : null;
  const sla = slaBadge(row.createdAt, slaThresholdDays);
  const flag = getFlag(row.country);
  const countryDisplay = getCountryName(row.country) || row.country || '';
  const tool = TOOLS[row.source];

  // Status badge colors — use per-status color when available, fall back to severity
  const sevConfig = {
    critical: { bg: '#fef2f2', color: '#d42d35', border: '#fca5a5', icon: 'bi-exclamation-triangle-fill' },
    warning:  { bg: '#fef3c7', color: '#92400e', border: '#ffe27c', icon: 'bi-exclamation-circle-fill' },
    active:   { bg: '#eff6ff', color: '#1d4ed8', border: '#bddcf0', icon: 'bi-arrow-repeat' },
    info:     { bg: '#f7f5f2', color: 'var(--text-secondary)', border: '#e8e8e8', icon: 'bi-clock' },
  };
  const baseCfg = sevConfig[sev] || sevConfig.info;
  // If the status has its own color, derive bg/border from it
  const statusColor = row.status?.color;
  const cfg = statusColor && statusColor !== baseCfg.color
    ? { ...baseCfg, color: statusColor, bg: statusColor + '12', border: statusColor + '40' }
    : baseCfg;

  return (
    <tr
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        // Lock row height for the virtualizer's arithmetic (44px === ROW_HEIGHT
        // in the parent). Without this the actual height drifts a few px per
        // row and the cumulative scroll position skews on long lists.
        height: 44,
        borderBottom: '1px solid #f0efed',
        background: isSelected ? '#eff6ff' : hov ? '#faf8ff' : rowBg,
        transition: 'background .1s',
        borderLeft: isUrgent ? '3px solid #d42d35' : isWarning ? '3px solid #ed8d00' : '3px solid transparent',
      }}
    >
      {/* Selection checkbox — only when the table is in bulk mode */}
      {isSelectable && (
        <td style={{ ...tdStyle, padding: '8px 12px', width: 36 }}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelection?.()}
            onClick={e => e.stopPropagation()}
            aria-label={isSelected ? `Deselect "${row.subject || row.id}"` : `Select "${row.subject || row.id}"`}
            style={{ cursor: 'pointer', width: 14, height: 14, accentColor: '#1d4ed8' }}
          />
        </td>
      )}

      {/* Source */}
      {showSource && (
        <td style={tdStyle}>
          {tool ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6, background: tool.bg, color: tool.color, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>
              <i className={tool.icon} style={{ fontSize: 9 }} />{tool.label}
            </span>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.source}</span>
          )}
        </td>
      )}

      {/* Subject — 2026-05-21 audit F29: full subject surfaced via
          `title=` so a hovered truncated row shows the complete name
          without forcing the user to expand the column. 2026-05-22:
          width is now driven by the user-resizable `--queue-subject-
          width` CSS variable (Chaitanya Raju Uppalapati feedback on
          the Workbench title). Inner span re-uses ellipsis so a long
          subject still truncates within whatever width the user picked. */}
      <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 600, color: 'var(--text)', maxWidth: 'var(--queue-subject-width, 280px)' }}
        title={row.subject || ''}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <div style={{
            width: 26, height: 26, borderRadius: '50%',
            background: tool?.bg || '#f3f3f3',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontWeight: 700, color: tool?.color || '#616161', flexShrink: 0,
          }}>
            {(row.subject || '?').split(' ').filter(w => w.length > 0).map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
            {row.subject || '--'}
          </span>
        </div>
      </td>

      {/* Client Name */}
      {showClient && (
        <td style={{ ...tdStyle, textAlign: 'left', fontSize: 12, color: 'var(--text)', fontWeight: 500, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={row.clientName || ''}>
          {row.clientName || '--'}
        </td>
      )}

      {/* Type (Termination / Resignation) */}
      {showType && (() => {
        const t = row.typeLabel || '';
        const isResignation = t.startsWith('Resignation');
        const bg = isResignation ? '#eef2ff' : '#fef2f2';
        const color = isResignation ? '#4338ca' : '#d42d35';
        const border = isResignation ? '#c7d2fe' : '#fca5a5';
        const short = t === 'Resignation (Employee)' ? 'Resign. (Emp)' : t === 'Resignation (Client)' ? 'Resign. (Client)' : t || '--';
        return (
          <td style={tdStyle}>
            {t ? (
              <span title={t} style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 128, background: bg, color, border: `1px solid ${border}`, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {short}
              </span>
            ) : <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>}
          </td>
        );
      })()}

      {/* Country */}
      <td style={{ ...tdStyle, fontSize: 12, whiteSpace: 'nowrap' }}>
        {flag && <span style={{ marginRight: 3 }}>{flag}</span>}
        <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{countryDisplay || '--'}</span>
      </td>

      {/* Assignee — read-only mirror of the Deel-side HRX. The previous
          "Assign me" button only set local state, didn't persist anywhere
          (see Erwin/Celine feedback Apr 2026). Refer to the Deel-assigned
          HRX; reassignment isn't supported on these queues.
          When `row.assigneeIsSynthetic === true` the assignee was synthesized from
          COUNTRY_OWNERS rather than read from the upstream payload — show
          a dotted underline + tooltip so the agent knows this is "country
          owner" attribution rather than a real upstream assignment. The
          2026-05-01 audit found that Trish couldn't tell synthetic from
          real. */}
      <td style={tdStyle} title={row.assignee ? (row.assigneeIsSynthetic ? `${row.assignee} — country owner (synthesized; no upstream assignee on this row)` : row.assignee) : 'Unassigned'}>
        {row.assignee ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
            <Avatar name={row.assignee} size="xs" />
            <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 80, borderBottom: row.assigneeIsSynthetic ? '1px dashed var(--text-muted)' : 'none', paddingBottom: row.assigneeIsSynthetic ? 1 : 0 }}>
              {row.assignee.split(' ')[0]}
            </span>
          </div>
        ) : <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>Unassigned</span>}
      </td>

      {/* Date column (Start Date for onboarding, End Date for offboarding, etc.) */}
      <td style={{ ...tdStyle, fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
        {(() => {
          const val = row[dateField];
          // Offboarding: when end date is not yet confirmed, mirror admin UI's "ASAP" label.
          if (dateField === 'endDate' && !row.endDateIsConfirmed) {
            if (val) return <span title={`Desired: ${fmtDate(val)}`} style={{ color: 'var(--text-muted)' }}>{fmtDate(val)}<span style={{ fontSize: 9, marginLeft: 4, color: '#b0b0b0' }}>(desired)</span></span>;
            return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>ASAP</span>;
          }
          return val ? fmtDate(val) : '--';
        })()}
      </td>

      {/* SLA — prefer the row's computed slaRemaining (honours dynamic
          Team-tab SLA settings) over the hardcoded-48h PausedSlaBadge.
          PausedSlaBadge only fires as a fallback when slaRemaining is
          missing (rare — happens when the row has no createdAt).
          Pablo Gonzalez 2026-05-28 — Immigration Tasks SLA windows are
          measured in hours (some only minutes) so the default days/hours
          rounding silently rounded a 10-min task to "0h" and a 90-min
          task to "1h". For that source we flip the formatter into
          minutes-up-to-24h, hours-past-that mode so the urgency reads
          truthfully. Every other source keeps the days/hours format. */}
      <td style={tdStyle}>
        {row.slaRemaining != null ? (
          <WorkbenchSlaBadge
            slaRemaining={row.slaRemaining}
            slaBreachStatus={row.slaBreachStatus}
            granularity={row.source === 'immigration_tasks' ? 'minutes' : 'days'}
          />
        ) : showPausedSla && row.pausedAt ? (
          <PausedSlaBadge pausedAt={row.pausedAt} />
        ) : sla ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 128, background: sla.bg, color: sla.color, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>
            <i className="bi-clock" style={{ fontSize: 8 }} /> {sla.label}
          </span>
        ) : <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>}
      </td>

      {/* Updated */}
      {!hideUpdated && (
        <td style={{ ...tdStyle, fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {row.updatedAt ? timeAgo(row.updatedAt) : '--'}
        </td>
      )}

      {/* Status */}
      <td style={tdStyle}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '3px 10px', borderRadius: 128,
          background: cfg.bg, color: cfg.color,
          border: `1px solid ${cfg.border}`,
          fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
        }}>
          <i className={cfg.icon} style={{ fontSize: 9 }} />
          {row.status?.label || '--'}
        </span>
      </td>

      {/* Task Link */}
      <td style={tdStyle}>
        <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
          {row.taskUrl && (
            <a href={row.taskUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6,
                background: hov ? '#e8f0fe' : '#f5f4f2', color: hov ? '#1f74b3' : '#9e9e9e',
                fontSize: 10, fontWeight: 600, textDecoration: 'none', transition: 'all .15s', whiteSpace: 'nowrap',
                border: hov ? '1px solid #c8d9f0' : '1px solid transparent',
              }}>
              <i className="bi-box-arrow-up-right" style={{ fontSize: 9 }} />Open
            </a>
          )}
          {row.jiraUrl && (() => {
            const jKey = jiraKeyFromUrl(row.jiraUrl);
            return (
              <a href={row.jiraUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                title={jKey ? `Open ${jKey} in Jira` : 'Open in Jira'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6,
                  background: hov ? '#e0ecff' : '#f5f4f2', color: hov ? '#0052CC' : '#9e9e9e',
                  fontSize: 10, fontWeight: 600, textDecoration: 'none', transition: 'all .15s', whiteSpace: 'nowrap',
                  border: hov ? '1px solid #b3d4ff' : '1px solid transparent',
                }}>
                <i className="bi-kanban" style={{ fontSize: 9 }} />{jKey || 'Jira'}
              </a>
            );
          })()}
          {row.zendeskUrl && (
            <a href={row.zendeskUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6,
                background: hov ? '#e7f5ee' : '#f5f4f2', color: hov ? '#03363d' : '#9e9e9e',
                fontSize: 10, fontWeight: 600, textDecoration: 'none', transition: 'all .15s', whiteSpace: 'nowrap',
                border: hov ? '1px solid #b8e0c8' : '1px solid transparent',
              }}>
              <i className="bi-headset" style={{ fontSize: 9 }} />Zendesk
            </a>
          )}
          {row.workbenchUrl && (
            <a href={row.workbenchUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6,
                background: hov ? '#f3eff8' : '#f5f4f2', color: hov ? '#6b3fa0' : '#9e9e9e',
                fontSize: 10, fontWeight: 600, textDecoration: 'none', transition: 'all .15s', whiteSpace: 'nowrap',
                border: hov ? '1px solid #d4c4f0' : '1px solid transparent',
              }}>
              <i className="bi-grid-3x3-gap" style={{ fontSize: 9 }} />Workbench
            </a>
          )}
          {!row.taskUrl && !row.jiraUrl && !row.zendeskUrl && !row.workbenchUrl && <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>}
        </div>
      </td>

      {/* Contract Link */}
      {!hideContract && (
        <td style={tdStyle}>
          {row.contractUrl ? (
            <a href={row.contractUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6,
                background: hov ? '#f3eff8' : '#f5f4f2', color: hov ? '#6b3fa0' : '#9e9e9e',
                fontSize: 10, fontWeight: 600, textDecoration: 'none', transition: 'all .15s', whiteSpace: 'nowrap',
                border: hov ? '1px solid #d4c4f0' : '1px solid transparent',
              }}>
              <i className="bi-file-earmark-text" style={{ fontSize: 9 }} />View
            </a>
          ) : <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>}
        </td>
      )}

      {/* Note — sticky-note icon. Filled amber when a note exists, outline
          grey otherwise. Click opens the editor (state lives in the parent
          SourceTable so one modal handles every row). */}
      {showNoteColumn && (
        <td style={tdStyle}>
          {onOpenNote && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenNote(); }}
              aria-label={hasNote ? `Edit note on "${row.subject || row.id}"` : `Add note to "${row.subject || row.id}"`}
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
      )}

      {/* Actions — Escalate + Reassign + Hide buttons. Cell only renders
          when the parent passed at least one handler so the column is
          opt-in. Reassign is wired in only on queues whose source rows
          can't be re-routed upstream (Onb / Amend / Redline / IP). */}
      {(onHide || onEscalate || onReassign || onSlaExtension) && (
        <td style={tdStyle}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {onEscalate && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onEscalate(); }}
                aria-label={`${escalateLabel}: "${row.subject || row.id}"`}
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
            )}
            {onReassign && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onReassign(); }}
                aria-label={`Reassign "${row.subject || row.id}" to another team member`}
                title="Reassign to another team member"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 8px', borderRadius: 6,
                  background: hov ? '#eff6ff' : '#f5f4f2',
                  color: hov ? '#1d4ed8' : '#9e9e9e',
                  border: hov ? '1px solid #bfdbfe' : '1px solid transparent',
                  fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <i className="bi-arrow-left-right" style={{ fontSize: 9 }} />
                Reassign
              </button>
            )}
            {onSlaExtension && (() => {
              // 2026-05-22 — Madeleine Solares Decuir reported that the
              // SLA Extension button kept appearing on offboarding rows
              // even after the team had already requested an extension,
              // so they re-clicked and were silently blocked by the
              // server's 409 dedup. When the row has an active extension
              // with >12h remaining OR a pending request, render a
              // non-clickable badge that surfaces the state so the user
              // knows not to ask again. Once the active window drops
              // below 12h the lockout lifts and the action returns.
              const locked = isSlaExtensionLocked(row);
              if (locked) {
                const isPending = !!row.slaExtensionPending;
                const ext = row.slaExtension;
                const expiresAt = ext?.expiresAt ? new Date(ext.expiresAt) : null;
                const expiresLabel = expiresAt && !isNaN(expiresAt)
                  ? expiresAt.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                  : null;
                const tooltip = isPending
                  ? `SLA extension request is in review (submitted ${row.slaExtensionPending?.createdAt ? new Date(row.slaExtensionPending.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'recently'}). You can request another once it resolves.`
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
                  onClick={(e) => { e.stopPropagation(); onSlaExtension(); }}
                  aria-label={`Request SLA extension for "${row.subject || row.id}"`}
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
            {onHide && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onHide(); }}
                aria-label={`Hide task "${row.subject || row.id}"`}
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
            )}
          </div>
        </td>
      )}
    </tr>
  );
});
SourceRow.displayName='SourceRow';

// ── Workbench SLA badge ──
// `granularity` controls the time formatter:
//   • 'days' (default) — days when ≥24h, hours when 1-23h, minutes <1h.
//     Used by Workbench / Onb / Off / Amend / Redline / IP — sources
//     whose SLA windows are measured in business DAYS so days-as-headline
//     is the right unit.
//   • 'minutes' — minutes when <24h, hours when ≥24h. Days never surface.
//     Used by Immigration Tasks per Pablo Gonzalez's 2026-05-28 feedback:
//     the upstream task SLAs there are measured in hours (some only
//     minutes), so the days/hours rounding rounded a 10-min task to "0h"
//     and lost the urgency signal entirely.
// `Math.abs(slaRemaining)` so the same math applies symmetrically on
// either side of zero — breach state is conveyed by the pill color, not
// by adding an "over" suffix to the text.
function WorkbenchSlaBadge({ slaRemaining, slaBreachStatus, granularity = 'days' }) {
  const SLA_MAP = {
    SLA_BREACHED:     { label: 'Breached', color: '#d42d35', bg: '#fef2f2' },
    SLA_NOT_BREACHED: { label: 'On Track', color: '#29811e', bg: '#e8f5e9' },
    SLA_PAUSED:       { label: 'Paused',   color: 'var(--text-secondary)', bg: '#f3f3f3' },
    SLA_NOT_STARTED:  { label: 'Not Set',  color: 'var(--text-muted)', bg: '#f7f5f2' },
  };
  const sla = SLA_MAP[slaBreachStatus] || null;
  if (!sla) return <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>;

  // Format remaining time
  let timeStr = '';
  if (slaRemaining != null) {
    const absSecs = Math.abs(slaRemaining);
    const mins = Math.floor(absSecs / 60);
    const hrs  = Math.floor(absSecs / 3600);
    if (granularity === 'minutes') {
      // < 24h → minutes; ≥ 24h → hours. Days never surfaces.
      if (mins < 1440) timeStr = `${mins}m`;
      else timeStr = `${hrs}h`;
    } else {
      // Default 'days' bucketing.
      if (hrs >= 24) timeStr = `${Math.floor(hrs / 24)}d`;
      else if (hrs > 0) timeStr = `${hrs}h`;
      else timeStr = `${mins}m`;
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 128, background: sla.bg, color: sla.color, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>
      <i className="bi-clock" style={{ fontSize: 8 }} />
      {timeStr || sla.label}
    </span>
  );
}

// ── Paused SLA badge (48 BIZ hours countdown from pausedAt) ──
// Fallback only — fires when a row has `pausedAt` but no `slaRemaining`.
// Uses business-day elapsed (Sat/Sun excluded) so this rare path doesn't
// drift from the rest of the SLA pipeline (`computeSlaWindow` /
// `WorkbenchSlaBadge`).
function PausedSlaBadge({ pausedAt }) {
  if (!pausedAt) return <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>;
  const pausedTime = new Date(pausedAt).getTime();
  if (isNaN(pausedTime)) return <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>;

  const SLA_MS = 48 * 60 * 60 * 1000; // 48 biz hours
  const elapsed = elapsedBizMs(pausedTime, Date.now());
  const remaining = SLA_MS - elapsed;

  let label, color, bg;
  if (remaining <= 0) {
    // Breached
    const overMs = Math.abs(remaining);
    const overHrs = Math.floor(overMs / 3600000);
    label = overHrs >= 24 ? `${Math.floor(overHrs / 24)}d over` : `${overHrs}h over`;
    color = '#d42d35'; bg = '#fef2f2';
  } else {
    const remHrs = Math.floor(remaining / 3600000);
    const remMins = Math.floor((remaining % 3600000) / 60000);
    if (remHrs >= 24) label = `${Math.floor(remHrs / 24)}d ${remHrs % 24}h`;
    else if (remHrs > 0) label = `${remHrs}h ${remMins}m`;
    else label = `${remMins}m`;

    if (remHrs < 6) { color = '#d42d35'; bg = '#fef2f2'; }       // < 6h — red
    else if (remHrs < 24) { color = '#ed8d00'; bg = '#fff8e6'; }  // < 24h — amber
    else { color = '#15803d'; bg = '#e8f5e9'; }                   // > 24h — green
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 128, background: bg, color, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>
      <i className="bi-hourglass-split" style={{ fontSize: 8 }} /> {label}
    </span>
  );
}

// ── StatusPill ──
function StatusPill({ label, count, active, onClick, color }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={!!active}
      aria-label={`Filter: ${label}${count > 0 ? ` (${count})` : ''}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '5px 12px', borderRadius: 128,
        border: active ? `1px solid ${color}` : '1px solid #e8e8e8',
        background: active ? `${color}10` : 'white',
        color: active ? color : '#616161',
        fontSize: 12, fontWeight: active ? 600 : 500,
        cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap',
      }}>
      {label}
      {count > 0 && (
        <span style={{ padding: '1px 6px', borderRadius: 128, fontSize: 10, fontWeight: 700, background: active ? `${color}18` : '#f2f2f2', color: active ? color : '#9e9e9e' }}>
          {count}
        </span>
      )}
    </button>
  );
}

// ── Sortable table header ──
// ── ResizableSubjectTh ─────────────────────────────────────────────────────
// Mirrors SortTh's sort UI (click to toggle ▲/▼) but adds a drag handle on
// the right edge that lets the user widen / narrow the Subject column.
// Reads its width from the table-level `--queue-subject-width` CSS variable
// (driven by SourceTable's resize state) so the th + every SourceRow td
// stay in lockstep without prop-drilling. Storage is email-scoped (helpers
// live in src/lib/queue-subject-width.js). The persistent rail + bi-arrows
// hint at the label tell the user the column is widenable before they ever
// hover the edge — per the Workbench-title feedback (Chaitanya 2026-05-22)
// asking for a clearer affordance.
const ResizableSubjectTh = memo(function ResizableSubjectTh({ sortCol, sortDir, onSort, onResizeStart, subjectLabel = 'Employee' }) {
  const active = sortCol === 'subject';
  const sortState = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  const [handleHov, setHandleHov] = useState(false);
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort('subject'); }
  };
  return (
    <th
      role="columnheader"
      aria-sort={sortState}
      onClick={() => onSort('subject')}
      onKeyDown={onKey}
      tabIndex={0}
      style={{
        ...thStyle,
        width: 'var(--queue-subject-width, 280px)',
        minWidth: SUBJECT_WIDTH_MIN,
        textAlign: 'left',
        cursor: 'pointer',
        userSelect: 'none',
        position: 'relative',
      }}
      aria-label={`Sort by ${subjectLabel}${active ? `, currently ${sortState}` : ''}. Drag the right edge to resize the column.`}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {subjectLabel}
        <span aria-hidden="true" style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1, gap: 0, fontSize: 7, marginTop: -1 }}>
          <i className="bi-caret-up-fill" style={{ color: active && sortDir === 'asc' ? '#1b1b1b' : '#ccc' }} />
          <i className="bi-caret-down-fill" style={{ color: active && sortDir === 'desc' ? '#1b1b1b' : '#ccc', marginTop: -3 }} />
        </span>
        {/* Persistent resize-affordance icon — faint at rest so users see
            the column is widenable before hovering the right edge. */}
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
        aria-label={`Resize ${subjectLabel} column`}
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
        {/* Persistent thin rail — always visible, thickens + accents on
            hover. Matches the Queue.jsx (ZD/Jira) handle exactly. */}
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

function SortTh({ col, label, sortCol, sortDir, onSort, style }) {
  const active = sortCol === col;
  const sortState = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSort(col);
    }
  };
  return (
    <th
      role="columnheader"
      aria-sort={sortState}
      style={{ ...style, cursor: 'pointer', userSelect: 'none' }}
      onClick={() => onSort(col)}
    >
      <span
        role="button"
        tabIndex={0}
        onKeyDown={onKey}
        aria-label={`Sort by ${label}${active ? `, currently ${sortState}` : ''}`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        {label}
        <span aria-hidden="true" style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1, gap: 0, fontSize: 7, marginTop: -1 }}>
          <i className="bi-caret-up-fill" style={{ color: active && sortDir === 'asc' ? '#1b1b1b' : '#ccc' }} />
          <i className="bi-caret-down-fill" style={{ color: active && sortDir === 'desc' ? '#1b1b1b' : '#ccc', marginTop: -3 }} />
        </span>
      </span>
    </th>
  );
}

// ── Styles ──
const iconBtnStyle = { width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
// Bulk-bar action button — solid colour fill on the dark bar so the action
// stands out against the "12 tasks selected" label. Color is the action's
// brand hue (purple = escalate, blue = reassign, red = hide).
const bulkBtnStyle = (color) => ({
  display: 'inline-flex', alignItems: 'center', gap: 5,
  background: color, color: 'white', border: '1px solid transparent',
  borderRadius: 8, padding: '6px 12px',
  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
});
// Compressed paddings (2026-05-25) — frees ~40-60px of horizontal space
// across the row so the Actions column stays visible without horizontal
// scroll on common 1280-1440px viewports. Users keep the Subject column
// resize handle when they want extra room.
const thStyle = { padding: '8px 6px', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid #e8e8e8' };
const tdStyle = { padding: '7px 6px', textAlign: 'center', verticalAlign: 'middle' };

// Pull the canonical Jira ticket key out of a Jira URL like
//   https://deel.atlassian.net/browse/DEELR-12345
// Mirrors the server-side extractor in app/api/v1/integrations/deel/
// offboarding/route.js so the chip label matches what ops actually pastes
// when referencing the ticket. Falls back to '' if nothing matches.
const JIRA_KEY_FROM_URL = /\/browse\/([A-Z][A-Z0-9_]+-\d+)/i;
const JIRA_KEY_ANYWHERE = /\b([A-Z][A-Z0-9_]+-\d+)\b/;
function jiraKeyFromUrl(url) {
  if (!url) return '';
  const m1 = url.match(JIRA_KEY_FROM_URL);
  if (m1) return m1[1].toUpperCase();
  const m2 = url.match(JIRA_KEY_ANYWHERE);
  return m2 ? m2[1].toUpperCase() : '';
}
