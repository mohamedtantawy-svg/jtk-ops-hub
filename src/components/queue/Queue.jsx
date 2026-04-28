import { useState, useEffect, useRef, useCallback, useMemo, useContext, memo } from 'react';
import { TOOLS, FUNCTIONS, SLA_MINS, getFlag } from '../../data/constants';
import { MEMBERS_BY_EMAIL } from '../../data/members';
import { slaInfo, getUrl } from '../../utils/helpers';
import {
  scopeOffboardingCases,
  scopeWorkbenchTasks,
  scopeOnboardingPeople,
  scopePausedOnboarding,
  scopeAmendmentRequests,
  scopeRedlineRequests,
  filterByAssignee as scopeTicketsByAssignee,
  getVisibleEmails,
  isAdminUser,
} from '../../lib/queue-scoping';
import { ToolBadge, StatusBadge, SlaBadge } from '../ui/Badges';
import { PermissionsContext, SettingsContext, IntegrationsContext } from '../../App';
import Avatar from '../ui/Avatar';
import { useQueueUnifiedSync } from '../../hooks/useQueueUnifiedSync';
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
} from '../../utils/normalizeSourceRows';

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
const relTime = (m) => {
  if (m <= 0) return 'now';
  if (m < 60) return `${m}m ago`;
  if (m < 120) { const r = m % 60; return r ? `1h ${r}m ago` : '1h ago'; }
  return `${Math.floor(m / 60)}h ago`;
};

// ── Work Source Button config ──
const WORK_SOURCES = [
  { id: 'onboarding',  label: 'Onboarding',  icon: 'bi-person-plus-fill', color: '#7c3aed', bg: '#f3eff8' },
  { id: 'offboarding', label: 'Offboarding', icon: 'bi-person-dash-fill', color: '#d42d35', bg: '#fef2f2' },
  { id: 'amendments',  label: 'Amendments',  icon: 'bi-pencil-square',    color: '#ed8d00', bg: '#fff8e6' },
  { id: 'redlines',    label: 'Redlines',    icon: 'bi-file-earmark-diff',color: '#7c3aed', bg: '#f3eff8' },
  { id: 'workbench',   label: 'Workbench',   icon: 'bi-grid-3x3-gap-fill',color: '#0369a1', bg: '#eff6ff' },
  { id: 'jira',        label: 'Jira',        icon: 'bi-kanban-fill',      color: '#1f74b3', bg: '#e8f0fe' },
  { id: 'zendesk',     label: 'Zendesk',     icon: 'bi-headset',          color: '#29811e', bg: '#e8f5e9' },
];

const PRIORITY_DOT = { critical: '#dc2626', high: '#d97706', medium: '#0369a1', low: '#9b928a' };

// Load saved filters from localStorage
const loadFilters = () => {
  try {
    const raw = localStorage.getItem('ops_hub_queue_filters');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const Queue = ({ user, tasks, subFilter }) => {
  const saved = useMemo(() => loadFilters(), []);
  const [fTool, setFTool] = useState(saved?.fTool || null);
  const [fStatus, setFStatus] = useState(() => {
    const s = saved?.fStatus;
    if (Array.isArray(s)) return s;
    if (s) return [s];
    return [];
  });
  const [search, setSearch] = useState('');
  const [fSla, setFSla] = useState(saved?.fSla || null);
  const [fJiraActionable, setFJiraActionable] = useState(saved?.fJiraActionable !== undefined ? !!saved.fJiraActionable : true);
  const [fJiraRaised, setFJiraRaised] = useState(saved?.fJiraRaised !== undefined ? !!saved.fJiraRaised : false);
  const [fUnassigned, setFUnassigned] = useState(saved?.fUnassigned || false);
  const [workSource, setWorkSource] = useState(null);

  const perms = useContext(PermissionsContext);
  const settings = useContext(SettingsContext);
  const { queueSync } = useContext(IntegrationsContext);

  // Wire subFilter from parent (BriefingView "View resolved" etc.) to internal filter
  useEffect(() => {
    if (subFilter) {
      const statusMap = { Resolved: 'resolved', New: 'new', 'In Progress': 'in_progress', Waiting: 'waiting' };
      const mapped = statusMap[subFilter] || subFilter.toLowerCase();
      setFStatus([mapped]);
    }
  }, [subFilter]);

  // Unified sync aggregator — one source of truth for all Deel feeds + tickets.
  const unified = useQueueUnifiedSync({ queueSync, enabled: !!user, userEmail: user?.email || null });
  const {
    onboardingData, pausedOnboardingData, offboardingData,
    changeRequestData, workbenchData,
    meta: syncMeta, sources: syncSources, refreshAll: syncRefreshAll, nowTick: syncNowTick,
  } = unified;

  // ── Normalized rows for SourceTable ──
  const { sla: queueSla } = useQueueSlaSettings();
  const onboardingRowsAll       = useMemo(() => normalizeOnboarding(onboardingData.items, queueSla), [onboardingData.items, queueSla]);
  const pausedOnboardingRowsAll = useMemo(() => normalizePausedOnboarding(pausedOnboardingData.items, queueSla), [pausedOnboardingData.items, queueSla]);
  const offboardingRowsAll      = useMemo(() => normalizeOffboarding(offboardingData.items, queueSla), [offboardingData.items, queueSla]);
  const amendmentRowsAll        = useMemo(() => normalizeAmendments(changeRequestData.amendments, queueSla), [changeRequestData.amendments, queueSla]);
  const redlineRowsAll          = useMemo(() => normalizeRedlines(changeRequestData.redlines, queueSla), [changeRequestData.redlines, queueSla]);
  const workbenchRowsAll        = useMemo(() => normalizeWorkbench(workbenchData.tasks, queueSla), [workbenchData.tasks, queueSla]);

  const isAdmin = isAdminUser(user);
  const isLead = perms?.dataScope === 'team_tasks';
  const ns = (tasks || []).filter(t => t.source !== 'slack' && t.source !== 'calendar');

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
  const allSourceRows   = useMemo(() => [
    ...onboardingRows, ...offboardingRows, ...amendmentRows, ...redlineRows, ...workbenchRows,
  ], [onboardingRows, offboardingRows, amendmentRows, redlineRows, workbenchRows]);

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
    // Fixed sort: SLA-urgency-first (most urgent at top, breached before at-risk
    // before ok), newest-first as tiebreaker.
    const sortArr = (arr) => {
      if (settings.sla_enabled === false) return [...arr].sort((a, b) => a.minutesAgo - b.minutesAgo);
      return [...arr].sort((a, b) => {
        const sa = slaInfo(a), sb = slaInfo(b);
        if (sa?.breach && !sb?.breach) return -1; if (!sa?.breach && sb?.breach) return 1;
        if (sa && !sb) return -1; if (!sa && sb) return 1;
        if (sa && sb) { const limA = SLA_MINS[a.type] || 1440, limB = SLA_MINS[b.type] || 1440; return (limA - (a.minutesSinceLastResponse ?? a.minutesAgo)) - (limB - (b.minutesSinceLastResponse ?? b.minutesAgo)); }
        return (b.minutesSinceLastResponse ?? b.minutesAgo) - (a.minutesSinceLastResponse ?? a.minutesAgo);
      });
    };
    const _sorted = sortArr(_vis.filter(t => t.status !== 'resolved' && t.status !== 'waiting'));
    const _snoozed = _vis.filter(t => t.status === 'waiting');
    const _done = _vis.filter(t => t.status === 'resolved');
    const _all = [..._sorted, ..._snoozed, ..._done];
    return { baseVis: _baseVis, visPreSla: _visPreSla, active: _sorted, snoozed: _snoozed, done: _done, all: _all };
  }, [ns, user, fTool, fStatus, fUnassigned, fSla, search, settings.sla_enabled, passesJiraRoleFilter]);

  const jiraRoleFilterActive = fJiraActionable !== true || fJiraRaised !== false;
  const hasActiveFilters = useMemo(() => !!(fTool || fStatus.length > 0 || fSla || fUnassigned || search || jiraRoleFilterActive), [fTool, fStatus, fSla, fUnassigned, search, jiraRoleFilterActive]);

  // ── Source-panel filter (status severity + unassigned) ──
  const applyPanelFilter = useCallback((rows) => {
    let r = Array.isArray(rows) ? rows : [];
    if (fStatus.length) r = r.filter(row => fStatus.includes(row?.status?.severity));
    if (fUnassigned)    r = r.filter(row => !row?.assigneeEmail);
    return r;
  }, [fStatus, fUnassigned]);

  // Pre-computed post-filter row sets — used by both SLA counts and tables
  const visOnboardingRows  = useMemo(() => applyPanelFilter(onboardingRows),  [onboardingRows, applyPanelFilter]);
  const visOffboardingRows = useMemo(() => applyPanelFilter(offboardingRows), [offboardingRows, applyPanelFilter]);
  const visAmendmentRows   = useMemo(() => applyPanelFilter(amendmentRows),   [amendmentRows, applyPanelFilter]);
  const visRedlineRows     = useMemo(() => applyPanelFilter(redlineRows),     [redlineRows, applyPanelFilter]);
  const visWorkbenchRows   = useMemo(() => applyPanelFilter(workbenchRows),   [workbenchRows, applyPanelFilter]);

  // ── SLA pills counts — reflect post-filter row sets per active tab ──
  const { atRiskCount, breachedCount, onTrackCount } = useMemo(() => {
    let slaBase;
    if (workSource === 'onboarding') {
      let atRisk = 0, breached = 0;
      for (const r of visOnboardingRows) {
        if (r.slaBreachStatus === 'SLA_BREACHED') { breached++; continue; }
        if (typeof r.slaRemaining === 'number' && r.slaRemaining > 0 && r.slaRemaining < 24 * 60 * 60) atRisk++;
      }
      return { atRiskCount: atRisk, breachedCount: breached, onTrackCount: visOnboardingRows.length - atRisk - breached };
    }
    if (workSource === 'offboarding') {
      let atRisk = 0, breached = 0;
      for (const r of visOffboardingRows) {
        if (r.slaBreachStatus === 'SLA_BREACHED') { breached++; continue; }
        if (typeof r.slaRemaining === 'number' && r.slaRemaining > 0 && r.slaRemaining < 24 * 60 * 60) atRisk++;
      }
      return { atRiskCount: atRisk, breachedCount: breached, onTrackCount: visOffboardingRows.length - atRisk - breached };
    }
    if (workSource === 'amendments') {
      let atRisk = 0, breached = 0;
      for (const r of visAmendmentRows) {
        if (typeof r.slaRemaining !== 'number') continue;
        if (r.slaRemaining <= 0) breached++;
        else if (r.slaRemaining < 21600) atRisk++;
      }
      return { atRiskCount: atRisk, breachedCount: breached, onTrackCount: visAmendmentRows.length - atRisk - breached };
    }
    if (workSource === 'redlines') {
      let atRisk = 0, breached = 0;
      for (const r of visRedlineRows) {
        if (typeof r.slaRemaining !== 'number') continue;
        if (r.slaRemaining <= 0) breached++;
        else if (r.slaRemaining < 21600) atRisk++;
      }
      return { atRiskCount: atRisk, breachedCount: breached, onTrackCount: visRedlineRows.length - atRisk - breached };
    }
    if (workSource === 'workbench') {
      let atRisk = 0, breached = 0;
      for (const r of visWorkbenchRows) {
        if (r.slaBreachStatus === 'SLA_BREACHED') { breached++; continue; }
        if (typeof r.slaRemaining === 'number' && r.slaRemaining > 0 && r.slaRemaining < 24 * 60 * 60) atRisk++;
      }
      return { atRiskCount: atRisk, breachedCount: breached, onTrackCount: visWorkbenchRows.length - atRisk - breached };
    }
    if (workSource === 'jira') slaBase = visPreSla.filter(t => t.source === 'jira');
    else if (workSource === 'zendesk') slaBase = visPreSla.filter(t => t.source === 'zendesk');
    else slaBase = visPreSla;
    slaBase = slaBase.filter(t => t.status !== 'resolved' && t.status !== 'waiting');
    const atRisk = slaBase.filter(t => { const s = slaInfo(t); return s && !s.ok && !s.breach; }).length;
    const breached = slaBase.filter(t => { const s = slaInfo(t); return s && s.breach; }).length;
    return { atRiskCount: atRisk, breachedCount: breached, onTrackCount: slaBase.length - atRisk - breached };
  }, [workSource, visPreSla, visOnboardingRows, visOffboardingRows, visAmendmentRows, visRedlineRows, visWorkbenchRows]);

  // ── View-aware header counts ──
  const headerCounts = useMemo(() => {
    if (workSource === 'onboarding')  return { open: visOnboardingRows.length,  paused: 0, resolved: 0 };
    if (workSource === 'offboarding') return { open: visOffboardingRows.length, paused: 0, resolved: 0 };
    if (workSource === 'amendments')  return { open: visAmendmentRows.length,   paused: 0, resolved: 0 };
    if (workSource === 'redlines')    return { open: visRedlineRows.length,     paused: 0, resolved: 0 };
    if (workSource === 'workbench')   return { open: visWorkbenchRows.length,   paused: 0, resolved: 0 };
    const sourceOpen = fTool ? 0 : (
      visOnboardingRows.length + visOffboardingRows.length + visAmendmentRows.length
      + visRedlineRows.length + visWorkbenchRows.length
    );
    return {
      open: active.length + sourceOpen,
      paused: snoozed.length,
      resolved: done.length,
    };
  }, [workSource, fTool, active, snoozed, done, visOnboardingRows, visOffboardingRows, visAmendmentRows, visRedlineRows, visWorkbenchRows]);

  const rawCounts = useMemo(() => {
    if (workSource === 'onboarding')  return { open: onboardingRows.length };
    if (workSource === 'offboarding') return { open: offboardingRows.length };
    if (workSource === 'amendments')  return { open: amendmentRows.length };
    if (workSource === 'redlines')    return { open: redlineRows.length };
    if (workSource === 'workbench')   return { open: workbenchRows.length };
    const base = fTool ? baseVis.filter(t => t.source === fTool) : baseVis;
    const srcExtra = fTool ? 0 : allSourceRows.length;
    return {
      open: base.filter(t => t.status !== 'resolved' && t.status !== 'waiting').length + srcExtra,
    };
  }, [workSource, fTool, baseVis, allSourceRows, onboardingRows, offboardingRows, amendmentRows, redlineRows, workbenchRows]);
  const hiddenByFilters = Math.max(0, rawCounts.open - headerCounts.open);

  // Persist filters to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('ops_hub_queue_filters', JSON.stringify({ fTool, fStatus, fSla, fUnassigned, fJiraActionable, fJiraRaised }));
    } catch {}
  }, [fTool, fStatus, fSla, fUnassigned, fJiraActionable, fJiraRaised]);

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
      <div data-role="queue-header" style={{ padding: '8px 32px 12px', background: 'white', borderBottom: '1px solid #e8e8e8', flexShrink: 0 }}>
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
            const sourceLabels = { onboarding: 'Onboarding', offboarding: 'Offboarding', amendments: 'Amendments', redlines: 'Redlines', workbench: 'Workbench' };
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
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 2 }}>
              {WORK_SOURCES.map(ws => {
                const isQueueFilter = ws.id === 'zendesk' || ws.id === 'jira';
                const isActive = isQueueFilter ? (fTool === ws.id && !workSource) : workSource === ws.id;
                const count = ws.id === 'onboarding' ? visOnboardingRows.length
                  : ws.id === 'offboarding' ? visOffboardingRows.length
                  : ws.id === 'amendments' ? visAmendmentRows.length
                  : ws.id === 'redlines' ? visRedlineRows.length
                  : ws.id === 'workbench' ? visWorkbenchRows.length
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
            rows={visOnboardingRows}
            loading={onboardingData.loading || pausedOnboardingData.loading}
            error={onboardingData.error || pausedOnboardingData.error}
            onRefresh={() => { onboardingData.refresh && onboardingData.refresh(); pausedOnboardingData.refresh && pausedOnboardingData.refresh(); }}
            emptyIcon="bi-person-plus"
            emptyLabel="No onboarding tasks"
            emptySubLabel="Nothing action-needed or paused"
            sortDefault="oldest"
            showPausedSla
            hideStatusPills
            showClient
          />
        </ErrorBoundary>
      )}
      {workSource === 'offboarding' && (
        <ErrorBoundary>
          <SourceTable
            rows={visOffboardingRows}
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
            hideFilterBar
          />
        </ErrorBoundary>
      )}
      {workSource === 'amendments' && (
        <ErrorBoundary>
          <SourceTable
            rows={visAmendmentRows}
            loading={changeRequestData.loading}
            error={changeRequestData.error}
            onRefresh={changeRequestData.refresh}
            emptyIcon="bi-pencil-square"
            emptyLabel="No amendments"
            emptySubLabel="Nothing action-needed or paused"
            sortDefault="oldest"
            showPausedSla
            showClient
            hideStatusPills
            hideUpdated
            dateField="createdAt"
            dateLabel="Requested Date"
          />
        </ErrorBoundary>
      )}
      {workSource === 'redlines' && (
        <ErrorBoundary>
          <SourceTable
            rows={visRedlineRows}
            loading={changeRequestData.loading}
            error={changeRequestData.error}
            onRefresh={changeRequestData.refresh}
            emptyIcon="bi-file-earmark-diff"
            emptyLabel="No actionable redlines"
            emptySubLabel="All redlines are handled"
            sortDefault="oldest"
            showClient
            hideStatusPills
            hideUpdated
            hideContract
            dateField="createdAt"
            dateLabel="Requested Date"
          />
        </ErrorBoundary>
      )}
      {workSource === 'workbench' && (
        <ErrorBoundary>
          <SourceTable
            rows={visWorkbenchRows}
            loading={workbenchData.loading}
            error={workbenchData.error}
            onRefresh={workbenchData.refresh}
            emptyIcon="bi-grid-3x3-gap"
            emptyLabel="No workbench tasks"
            emptySubLabel="All HRX Operations tasks are processed"
            sortDefault="oldest"
            showType
            hideUpdated
            hideContract
            hideStatusPills
            dateField="createdAt"
            dateLabel="Created"
          />
        </ErrorBoundary>
      )}

      {/* ── Main ZD/JR table (when no work source is active) ── */}
      {!workSource && (
        <div style={{ flex: 1, overflowY: 'auto', background: '#fafaf9' }}>
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
                  <th scope="col" style={{ ...thStyle, width: 80 }}>Source</th>
                  <th scope="col" style={{ ...thStyle, textAlign: 'left', minWidth: 200 }}>Subject</th>
                  <th scope="col" style={{ ...thStyle, width: 90 }}>Function</th>
                  <th scope="col" style={{ ...thStyle, width: 50 }}>Country</th>
                  <th scope="col" style={{ ...thStyle, width: 80 }}>Assignee</th>
                  <th scope="col" style={{ ...thStyle, width: 68 }}>Received</th>
                  {settings.sla_enabled !== false && <th scope="col" style={{ ...thStyle, width: 60 }}>SLA</th>}
                  <th scope="col" style={{ ...thStyle, width: 90 }}>Status</th>
                  <th scope="col" style={{ ...thStyle, width: 60 }}>Link</th>
                </tr>
              </thead>
              <tbody>
                {active.map(task => <QueueRow key={task.id} task={task} slaAgeClass={slaAgeClass} settings={settings}/>)}
                {snoozed.length > 0 && (
                  <tr><td colSpan={settings.sla_enabled !== false ? 9 : 8} style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#6b6560', letterSpacing: '.04em', background: '#faf9f7', borderTop: '1px solid #e8e8e8', borderBottom: '1px solid #e8e8e8' }}><i className="bi-pause-circle-fill" style={{ fontSize: 11, marginRight: 6 }}></i>SNOOZED ({snoozed.length})</td></tr>
                )}
                {snoozed.map(task => <QueueRow key={task.id} task={task} slaAgeClass={slaAgeClass} settings={settings}/>)}
                {done.length > 0 && (
                  <tr><td colSpan={settings.sla_enabled !== false ? 9 : 8} style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#29811e', letterSpacing: '.04em', background: '#f9faf8', borderTop: '1px solid #e8e8e8', borderBottom: '1px solid #e8e8e8' }}><i className="bi-check-circle" style={{ fontSize: 11, marginRight: 6 }}></i>RESOLVED TODAY ({done.length})</td></tr>
                )}
                {done.map(task => <QueueRow key={task.id} task={task} slaAgeClass={slaAgeClass} settings={settings}/>)}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

// ── Table row component ──
const QueueRow = memo(({ task, slaAgeClass, settings }) => {
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
      style={{ borderBottom: '1px solid #f0efed', background: hov ? '#fafaf9' : 'white', transition: 'background 0.1s', borderLeft: priColor ? `3px solid ${priColor}` : '3px solid transparent' }}
    >
      {/* Source */}
      <td style={tdStyle}><ToolBadge source={task.source}/></td>
      {/* Subject */}
      <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 600, color: '#1b1b1b', maxWidth: 320 }}>
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
      {/* Country */}
      <td style={{ ...tdStyle, fontSize: 12 }}>
        {task.country && <span>{getFlag(task.country)} <span style={{ color: '#616161', fontWeight: 500 }}>{task.country}</span></span>}
      </td>
      {/* Assignee */}
      <td style={tdStyle}>
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
    </tr>
  );
});
QueueRow.displayName = 'QueueRow';

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
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, background: 'white', border: '1px solid #e8e8e8', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 200, minWidth: 260, maxHeight: 360, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
