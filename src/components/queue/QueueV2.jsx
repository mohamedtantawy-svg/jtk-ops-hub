// ── QueueV2 ──────────────────────────────────────────────────────────────────
// "Top-tier" focused queue: one header, one filter bar, 3 source groups,
// unified SLA, side-dock drawer, keyboard-first, saved views, rules, bundling,
// SLA forecast, CSV export, shareable URLs, undo, inbox-zero celebration.
//
// Morning briefing is intentionally on the Home/Briefing view, not here.
// The Queue stays focused on tasks + tickets.

import { useState, useEffect, useMemo, useCallback, useContext, useRef } from 'react';
import { getFlag, getCountryName } from '../../data/constants';
import { MEMBERS_BY_EMAIL, getDirectReports } from '../../data/members';
import { OWNER_COUNTRIES } from '../../data/countryOwners';
import { getVisibleEmails } from '../../utils/helpers';
import { PermissionsContext, SettingsContext, IntegrationsContext } from '../../App';
import { useOnboardingData } from '../../hooks/useOnboardingData';
import { useOffboardingData } from '../../hooks/useOffboardingData';
import { useChangeRequestData } from '../../hooks/useChangeRequestData';
import { useWorkbenchData } from '../../hooks/useWorkbenchData';
import { usePausedOnboardingData } from '../../hooks/usePausedOnboardingData';
import {
  normalizeOnboarding,
  normalizeOffboarding,
  normalizeAmendments,
  normalizeRedlines,
  normalizeWorkbench,
  normalizePausedOnboarding,
} from '../../utils/normalizeSourceRows';
import SourceTableV2 from './SourceTableV2';
import QueueV2Drawer from './QueueV2Drawer';
import { ShortcutHelp, CommandPalette } from './QueueV2Shortcuts';
import { SavedViewsStrip, RulesEditor } from './QueueV2Panels';
import OutboundQueue from './OutboundQueue';
import ErrorBoundary from '../ui/ErrorBoundary';
import { updateTaskStatus as apiUpdateStatus, assignTask as apiAssignTask } from '../../services/tasksApi';
import {
  computeSla, slaForecast, exportCsv,
  filtersToQuery, queryToFilters,
  loadRules, saveRules, applyRules,
  bundleRows, isOutsideWorkingHours,
  createPresenceChannel, diffNewIds,
  getOooState, setOooState,
} from './queueV2Utils';

// ── Source groupings for the 3-tab header ────────────────────────────────────
const GROUPS = [
  { id: 'all',     label: 'All',     icon: 'bi-grid' },
  { id: 'tasks',   label: 'Tasks',   icon: 'bi-kanban' },
  { id: 'tickets', label: 'Tickets', icon: 'bi-headset' },
];
const TASK_SUBSOURCES = [
  { id: 'onboarding',  label: 'Onboarding',  color: '#7c3aed' },
  { id: 'offboarding', label: 'Offboarding', color: '#d42d35' },
  { id: 'amendments',  label: 'Amendments',  color: '#ed8d00' },
  { id: 'redlines',    label: 'Redlines',    color: '#7c3aed' },
  { id: 'workbench',   label: 'Workbench',   color: '#0369a1' },
];
const TICKET_SUBSOURCES = [
  { id: 'jira',    label: 'Jira',    color: '#1f74b3' },
  { id: 'zendesk', label: 'Zendesk', color: '#29811e' },
];

const ZDJR_STATUS = {
  new:         { label: 'New',         color: '#7c3aed', severity: 'active'   },
  in_progress: { label: 'In Progress', color: '#1d4ed8', severity: 'active'   },
  waiting:     { label: 'Waiting',     color: '#6b6560', severity: 'info'     },
  escalated:   { label: 'Escalated',   color: '#d42d35', severity: 'critical' },
  resolved:    { label: 'Resolved',    color: '#15803d', severity: 'info'     },
};

function normalizeZdJr(t) {
  const createdAt = t.minutesAgo != null ? new Date(Date.now() - t.minutesAgo * 60000).toISOString() : '';
  const status = ZDJR_STATUS[t.status] || { label: t.status || 'Unknown', color: '#616161', severity: 'info' };
  return {
    id: t.id,
    source: t.source,
    subject: t.subject || '(no subject)',
    subtitle: t.type || '',
    country: t.country || '',
    assignee: t.assigneeName || '',
    assigneeEmail: t.assigneeEmail || '',
    createdAt,
    dateValue: createdAt,
    status,
    openUrl: t.externalUrl || '',
    _raw: t,
  };
}

// ── Main component ───────────────────────────────────────────────────────────
// Props accepted from App.jsx. We destructure only what we use — the other
// props (notes/activity/selTask/etc.) are unused here because V2 renders its
// own drawer and doesn't share the legacy Detail modal.
const QueueV2 = ({
  user, tasks, setTasks,
  addToast, onEscalMgr, onReassign, onSnooze,
  requests, setRequests, onNewRequest,
  queueMode, setQueueMode, fUnassigned, setFUnassigned,
}) => {
  const perms = useContext(PermissionsContext);
  const settings = useContext(SettingsContext);
  const { queueSync } = useContext(IntegrationsContext);

  const onboardingData = useOnboardingData(true);
  const offboardingData = useOffboardingData(true);
  const changeRequestData = useChangeRequestData(true);
  const workbenchData = useWorkbenchData(true);
  const pausedOnboardingData = usePausedOnboardingData(true);

  // ── Filter state ─────────────────────────────────────────────────────────
  const [group, setGroup] = useState('all');
  const [subSource, setSubSource] = useState(null);
  const [fStatus, setFStatus] = useState('');
  const [fCountry, setFCountry] = useState([]);
  const [fSla, setFSla] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('sla');

  // ── Display state ────────────────────────────────────────────────────────
  const [focus, setFocus] = useState(false);
  const [density, setDensity] = useState('comfortable');
  const [bundle, setBundle] = useState(false);
  const [twoPane, setTwoPane] = useState(false);
  const [ooo, setOoo] = useState(() => getOooState(user?.email).ooo);

  // Track "new since first render" IDs for the NEW badge flash
  const seenRef = useRef({ initialised: false, seen: new Set(), firstSeenAt: new Map() });

  // Presence map: rowId → { userId, name, ts }
  const [presence, setPresence] = useState(new Map());
  const presenceChanRef = useRef(null);

  // ── Selection + drawer ───────────────────────────────────────────────────
  // Track selection by row ID, not index. When filters change, a stored index
  // would point to a different row; tracking the ID keeps the selection stable
  // (and clears cleanly when the selected row is no longer visible).
  const [drawerRow, setDrawerRow] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  // ── Overlays ─────────────────────────────────────────────────────────────
  const [helpOpen, setHelpOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  // ── Saved views + rules (localStorage) ───────────────────────────────────
  const [savedViews, setSavedViews] = useState(() => {
    try {
      const raw = localStorage.getItem('ops_hub_queuev2_views');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [currentViewName, setCurrentViewName] = useState(null);
  const [rules, setRules] = useState(() => loadRules());

  // ── Undo toast queue ─────────────────────────────────────────────────────
  const [undo, setUndo] = useState(null); // { id, message, revert: () => void, timer }
  const undoTimerRef = useRef(null);

  // ── Permission scoping (mirrors legacy Queue) ────────────────────────────
  const isAdmin = perms?.dataScope === 'all_tasks';
  const visibleEmails = useMemo(() => getVisibleEmails(user?.email), [user?.email]);
  const scopedOwnedCodes = useMemo(() => {
    const email = (user?.email || '').toLowerCase();
    const member = MEMBERS_BY_EMAIL[email];
    const access = member?.access || 'agent';
    const codes = new Set(OWNER_COUNTRIES.get(email) || []);
    if (access === 'team_lead') {
      for (const dr of getDirectReports(email)) {
        const dc = OWNER_COUNTRIES.get(dr.email.toLowerCase());
        if (dc) for (const c of dc) codes.add(c);
      }
    }
    return { codes, access };
  }, [user?.email]);

  const filterByAssignee = useCallback((rows) => {
    if (isAdmin) return rows;
    return rows.filter(r => {
      const email = (r.assigneeEmail || '').toLowerCase();
      return email && visibleEmails.has(email);
    });
  }, [isAdmin, visibleEmails]);
  const filterOnboarding = useCallback((rows) => {
    if (isAdmin) return rows;
    if (scopedOwnedCodes.access === 'regional_manager') return rows;
    if (scopedOwnedCodes.codes.size === 0) return [];
    return rows.filter(r => {
      const cc = (r.country || '').toUpperCase();
      return cc && scopedOwnedCodes.codes.has(cc);
    });
  }, [isAdmin, scopedOwnedCodes]);
  const filterOffboarding = useCallback((rows) => {
    if (isAdmin) return rows;
    return rows.filter(r => {
      const assignee = (r.assigneeEmail || '').toLowerCase();
      if (assignee) return visibleEmails.has(assignee);
      if (scopedOwnedCodes.access === 'regional_manager') return true;
      const cc = (r.country || '').toUpperCase();
      return cc && scopedOwnedCodes.codes.has(cc);
    });
  }, [isAdmin, visibleEmails, scopedOwnedCodes]);

  // ── Collect & normalize all rows ─────────────────────────────────────────
  const allRows = useMemo(() => {
    const onb   = filterOnboarding(normalizeOnboarding(onboardingData.items));
    const pOnb  = filterOnboarding(normalizePausedOnboarding(pausedOnboardingData.items));
    const off   = filterOffboarding(normalizeOffboarding(offboardingData.items));
    const amds  = filterByAssignee(normalizeAmendments(changeRequestData.amendments));
    const rdl   = filterByAssignee(normalizeRedlines(changeRequestData.redlines));
    const wb    = filterByAssignee(normalizeWorkbench(workbenchData.tasks));
    const deel  = [...onb, ...pOnb, ...off, ...amds, ...rdl, ...wb].map(r => ({ ...r, _group: 'tasks' }));

    const zdJr = (tasks || [])
      .filter(t => t.source === 'zendesk' || t.source === 'jira')
      .filter(t => {
        if (isAdmin) return true;
        if (t.assigneeId === user?.id) return true;
        if (t.assigneeEmail && visibleEmails.has(t.assigneeEmail.toLowerCase())) return true;
        return false;
      })
      .filter(t => !t.isCalendarBooking)
      .map(normalizeZdJr)
      .map(r => ({ ...r, _group: 'tickets' }));

    const joined = [...deel, ...zdJr].map(r => ({
      ...r,
      sla: computeSla(r),
      dateValue: r.dateValue || r.startDate || r.endDate || r.createdAt,
    }));
    return applyRules(joined, rules);
  }, [
    onboardingData.items, pausedOnboardingData.items, offboardingData.items,
    changeRequestData.amendments, changeRequestData.redlines, workbenchData.tasks,
    tasks, isAdmin, user?.id, visibleEmails, filterOnboarding, filterOffboarding, filterByAssignee,
    rules,
  ]);

  // ── Group counts ─────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c = { all: allRows.length, tasks: 0, tickets: 0 };
    for (const r of allRows) {
      if (r._group === 'tasks') c.tasks++;
      else if (r._group === 'tickets') c.tickets++;
    }
    return c;
  }, [allRows]);
  const subCounts = useMemo(() => {
    const c = {};
    for (const r of allRows) c[r.source] = (c[r.source] || 0) + 1;
    return c;
  }, [allRows]);

  // ── Filter pipeline ──────────────────────────────────────────────────────
  const visibleRows = useMemo(() => {
    let rows = allRows;
    if (group !== 'all') rows = rows.filter(r => r._group === group);
    if (subSource)       rows = rows.filter(r => r.source === subSource);
    if (fStatus)         rows = rows.filter(r => (r.status?.severity === fStatus) || (r._raw?.status === fStatus));
    if (fCountry.length) rows = rows.filter(r => fCountry.includes(r.country));
    if (fSla)            rows = rows.filter(r => r.sla?.severity === fSla);
    if (fUnassigned)     rows = rows.filter(r => !r.assignee);
    if (focus)           rows = rows.filter(r => r.sla?.severity === 'breached' || r.sla?.severity === 'at_risk');
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        (r.subject || '').toLowerCase().includes(q) ||
        (r.country || '').toLowerCase().includes(q) ||
        (r.assignee || '').toLowerCase().includes(q) ||
        (r.subtitle || '').toLowerCase().includes(q) ||
        (r.id || '').toLowerCase().includes(q)
      );
    }
    const dir = sort === 'newest' ? -1 : 1;
    const arr = [...rows];
    if (sort === 'sla') {
      arr.sort((a, b) => (a.sla?.rank ?? 1e9) - (b.sla?.rank ?? 1e9));
    } else {
      arr.sort((a, b) => {
        const av = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bv = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return (av - bv) * dir;
      });
    }
    return arr;
  }, [allRows, group, subSource, fStatus, fCountry, fSla, fUnassigned, search, sort, focus]);

  // ── Items (apply bundling if enabled) ────────────────────────────────────
  const items = useMemo(() => (
    bundle ? bundleRows(visibleRows) : visibleRows.map(row => ({ type: 'row', row }))
  ), [visibleRows, bundle]);

  // ── Country options for filter ───────────────────────────────────────────
  const countryOptions = useMemo(() => {
    const s = new Set();
    for (const r of allRows) if (r.country) s.add(r.country);
    return [...s].sort();
  }, [allRows]);

  // ── SLA forecast ─────────────────────────────────────────────────────────
  const forecast = useMemo(() => slaForecast(visibleRows), [visibleRows]);

  // ── Working-hours dim ────────────────────────────────────────────────────
  // Recomputed on each `nowTick` so the dim flips when the clock crosses 9am/6pm.

  // ── NEW badge: track freshly-seen IDs; expire after 15s ──────────────────
  // We depend on `_newTick` so the memo re-runs when the 15s timer fires.
  const [_newTick, setNewTick] = useState(0);
  const newIds = useMemo(() => {
    const ids = visibleRows.map(r => r.id);
    return diffNewIds(ids, seenRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows, _newTick]);
  useEffect(() => {
    if (!newIds || newIds.size === 0) return;
    const t = setTimeout(() => setNewTick(n => n + 1), 15_000);
    return () => clearTimeout(t);
  }, [newIds]);

  // Clear selectedId if the selected row is no longer visible after filters change.
  useEffect(() => {
    if (!selectedId) return;
    if (!visibleRows.some(r => r.id === selectedId)) setSelectedId(null);
  }, [visibleRows, selectedId]);

  // Derived index from the selectedId, for j/k navigation math.
  const selectedIdx = useMemo(() => {
    if (!selectedId) return -1;
    return visibleRows.findIndex(r => r.id === selectedId);
  }, [visibleRows, selectedId]);

  // Tick "now" every 10s so "last synced X ago" stays accurate and working-hours flip at the right time.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  // Working-hours dim — tick-dependent so it flips as time passes.
  const outsideHours = useMemo(() => isOutsideWorkingHours(), [nowTick]);

  // Track last-successful-refresh for all Deel sources (the ZD/JR time is in
  // queueSync.meta.syncedAt already). We piggy-back on `loading` going false
  // after having been true, which means a fetch just completed.
  const deelRefreshAtRef = useRef({
    onboarding: Date.now(), paused: Date.now(),
    offboarding: Date.now(), changeRequests: Date.now(), workbench: Date.now(),
  });
  const prevLoadingRef = useRef({});
  useEffect(() => {
    const cur = {
      onboarding: onboardingData.loading, paused: pausedOnboardingData.loading,
      offboarding: offboardingData.loading, changeRequests: changeRequestData.loading, workbench: workbenchData.loading,
    };
    for (const k of Object.keys(cur)) {
      if (prevLoadingRef.current[k] === true && cur[k] === false) {
        deelRefreshAtRef.current[k] = Date.now();
      }
    }
    prevLoadingRef.current = cur;
  }, [onboardingData.loading, pausedOnboardingData.loading, offboardingData.loading, changeRequestData.loading, workbenchData.loading]);

  // Most recent sync across all sources
  const lastSyncAt = useMemo(() => {
    const zdJrTs = queueSync?.meta?.syncedAt ? new Date(queueSync.meta.syncedAt).getTime() : 0;
    const deelTs = Math.max(...Object.values(deelRefreshAtRef.current));
    return Math.max(zdJrTs, deelTs);
    // Depend on nowTick so this recomputes on the 10s cadence for display.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueSync?.meta?.syncedAt, nowTick]);

  const lastSyncAgo = useMemo(() => formatAgo(lastSyncAt, nowTick), [lastSyncAt, nowTick]);

  // ── Presence channel ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const chan = createPresenceChannel(user.id || user.email, user.name || user.email || 'agent');
    presenceChanRef.current = chan;
    const unsub = chan.subscribe((msg) => {
      if (!msg || !msg.rowId) return;
      if (msg.userId === (user.id || user.email)) return; // ignore self
      setPresence(prev => {
        const next = new Map(prev);
        next.set(msg.rowId, { userId: msg.userId, name: msg.name, ts: msg.ts });
        return next;
      });
    });
    return () => { unsub(); chan.close(); };
  }, [user]);

  // Broadcast the current drawerRow as "viewing" (debounced/simple)
  useEffect(() => {
    presenceChanRef.current?.broadcast(drawerRow?.id || null);
  }, [drawerRow]);

  // Clean up presence entries older than 60s
  useEffect(() => {
    const t = setInterval(() => {
      setPresence(prev => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [k, v] of prev) {
          if (now - v.ts > 60_000) { next.delete(k); changed = true; }
        }
        return changed ? next : prev;
      });
    }, 20_000);
    return () => clearInterval(t);
  }, []);

  // ── Per-source sync diagnostics ──────────────────────────────────────────
  const sourceErrors = useMemo(() => {
    const zdErr = queueSync?.meta?.zendesk?.error;
    const jrErr = queueSync?.meta?.jira?.error;
    const errs = [];
    if (zdErr) errs.push({ source: 'zendesk', label: 'Zendesk', error: zdErr });
    if (jrErr) errs.push({ source: 'jira', label: 'Jira', error: jrErr });
    if (onboardingData.error) errs.push({ source: 'onboarding', label: 'Onboarding', error: onboardingData.error, retry: onboardingData.refresh });
    if (offboardingData.error) errs.push({ source: 'offboarding', label: 'Offboarding', error: offboardingData.error, retry: offboardingData.refresh });
    if (changeRequestData.error) errs.push({ source: 'changeRequests', label: 'Amendments/Redlines', error: changeRequestData.error, retry: changeRequestData.refresh });
    if (workbenchData.error) errs.push({ source: 'workbench', label: 'Workbench', error: workbenchData.error, retry: workbenchData.refresh });
    return errs;
  }, [
    queueSync?.meta?.zendesk?.error, queueSync?.meta?.jira?.error,
    onboardingData.error, onboardingData.refresh,
    offboardingData.error, offboardingData.refresh,
    changeRequestData.error, changeRequestData.refresh,
    workbenchData.error, workbenchData.refresh,
  ]);

  // ── Filter persistence + URL sync ────────────────────────────────────────
  // Load from URL first (if present), else localStorage.
  useEffect(() => {
    let loaded = null;
    if (typeof window !== 'undefined') {
      const url = window.location.search;
      if (url && url.length > 1) loaded = queryToFilters(url);
    }
    if (!loaded || Object.keys(loaded).length === 0) {
      try {
        const raw = localStorage.getItem('ops_hub_queuev2_filters');
        if (raw) loaded = JSON.parse(raw);
      } catch {}
    }
    if (loaded) {
      if (loaded.group) setGroup(loaded.group);
      if (loaded.subSource !== undefined) setSubSource(loaded.subSource);
      if (loaded.fStatus) setFStatus(loaded.fStatus);
      if (Array.isArray(loaded.fCountry)) setFCountry(loaded.fCountry);
      if (loaded.fSla !== undefined) setFSla(loaded.fSla);
      if (loaded.sort) setSort(loaded.sort);
      if (loaded.search) setSearch(loaded.search);
      if (loaded.focus) setFocus(true);
      if (loaded.density) setDensity(loaded.density);
      if (loaded.bundle) setBundle(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem('ops_hub_queuev2_filters', JSON.stringify({
        group, subSource, fStatus, fCountry, fSla, sort, search, focus, density, bundle,
      }));
    } catch {}
  }, [group, subSource, fStatus, fCountry, fSla, sort, search, focus, density, bundle]);

  // Clear sub-source if it doesn't belong to current group
  useEffect(() => {
    if (!subSource) return;
    if (group === 'all') { setSubSource(null); return; }
    const valid = group === 'tasks' ? TASK_SUBSOURCES : TICKET_SUBSOURCES;
    if (!valid.some(s => s.id === subSource)) setSubSource(null);
  }, [group, subSource]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const scheduleUndo = useCallback((message, revertFn) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndo({ id: Date.now(), message, revert: revertFn });
    undoTimerRef.current = setTimeout(() => setUndo(null), 5000);
  }, []);

  // Clean up pending undo timer on unmount (avoids stray state update on unmounted component)
  useEffect(() => {
    const ref = undoTimerRef;
    return () => { if (ref.current) clearTimeout(ref.current); };
  }, []);

  const doResolve = useCallback((row) => {
    if (!row) return;
    if (row._group !== 'tickets') {
      addToast?.('info', 'Resolve on source', 'Open the source system to mark this complete.');
      return;
    }
    const prev = tasks.find(t => t.id === row._raw?.id);
    if (!prev) return;
    const beId = row._raw._beId || row._raw.id;
    // Optimistic UI
    setTasks(list => list.map(t => t.id === row._raw.id ? { ...t, status: 'resolved' } : t));
    // Persist to backend (fire-and-forget — matches legacy Queue behaviour)
    apiUpdateStatus(beId, 'resolved').catch(err => {
      console.warn('[QueueV2] Resolve sync failed:', err.message);
      addToast?.('error', 'Resolve sync failed', err.message || 'Server did not accept the change.');
    });
    scheduleUndo(`Resolved ${row._raw.id}`, () => {
      setTasks(list => list.map(t => t.id === row._raw.id ? { ...t, status: prev.status } : t));
      apiUpdateStatus(beId, prev.status).catch(err => {
        console.warn('[QueueV2] Undo sync failed:', err.message);
      });
    });
  }, [tasks, setTasks, addToast, scheduleUndo]);

  const doAssignMe = useCallback((row) => {
    if (!row || !user) return;
    if (row._group !== 'tickets') {
      addToast?.('info', 'Self-assign on source', 'Use the admin UI to self-assign this task.');
      return;
    }
    const prev = tasks.find(t => t.id === row._raw?.id);
    if (!prev) return;
    const beId = row._raw._beId || row._raw.id;
    setTasks(list => list.map(t => t.id === row._raw.id ? {
      ...t, assigneeId: user.id, assigneeEmail: user.email, assigneeName: user.name,
    } : t));
    // Persist to backend
    apiAssignTask(beId, user.id).catch(err => {
      console.warn('[QueueV2] Assign sync failed:', err.message);
      addToast?.('error', 'Assign sync failed', err.message || 'Server did not accept the change.');
    });
    scheduleUndo(`Assigned ${row._raw.id} to you`, () => {
      setTasks(list => list.map(t => t.id === row._raw.id ? {
        ...t, assigneeId: prev.assigneeId, assigneeEmail: prev.assigneeEmail, assigneeName: prev.assigneeName,
      } : t));
      if (prev.assigneeId) {
        apiAssignTask(beId, prev.assigneeId).catch(err => {
          console.warn('[QueueV2] Undo assign sync failed:', err.message);
        });
      }
      // If it was unassigned, the local revert is enough — next sync will re-fetch true state
    });
  }, [tasks, setTasks, user, addToast, scheduleUndo]);

  const handleRowAction = useCallback((row, action) => {
    if (!row) return;
    const id = typeof action === 'string' ? action : action?.id;
    if (id === 'assign') return doAssignMe(row);
    if (id === 'escalate') return row._raw && onEscalMgr?.(row._raw);
    if (id === 'reassign') return row._raw && onReassign?.(row._raw);
    if (id === 'snooze')   return row._raw && onSnooze?.(row._raw);
    if (id === 'resolve')  return doResolve(row);
    if (id === 'open' || id === 'start' || id === 'nudge' || id === 'confirm_end_date') {
      if (row.openUrl) window.open(row.openUrl, '_blank', 'noopener,noreferrer');
    }
  }, [doAssignMe, doResolve, onEscalMgr, onReassign, onSnooze]);

  const handleRowClick = useCallback((row) => {
    setDrawerRow(row);
    setSelectedId(row.id);
  }, []);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  const gSeqRef = useRef({ armed: false, timer: null });
  useEffect(() => {
    const kd = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      if (helpOpen || paletteOpen || rulesOpen) return;

      // Undo
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (undo?.revert) {
          e.preventDefault();
          undo.revert();
          setUndo(null);
          if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        }
        return;
      }

      // Overlay triggers
      if (e.key === '?') { e.preventDefault(); setHelpOpen(true); return; }
      if (e.key === '/') { e.preventDefault(); setPaletteOpen(true); return; }

      // g + a / t / k combos
      if (gSeqRef.current.armed) {
        gSeqRef.current.armed = false;
        if (gSeqRef.current.timer) clearTimeout(gSeqRef.current.timer);
        if (e.key === 'a') { setGroup('all'); return; }
        if (e.key === 't') { setGroup('tasks'); return; }
        if (e.key === 'k') { setGroup('tickets'); return; }
      }
      if (e.key === 'g') {
        gSeqRef.current.armed = true;
        gSeqRef.current.timer = setTimeout(() => { gSeqRef.current.armed = false; }, 800);
        return;
      }

      // Navigation — move by ID, not by index, so filter changes don't misfire.
      if (e.key === 'j') {
        if (!visibleRows.length) return;
        const next = selectedIdx < 0 ? 0 : Math.min(selectedIdx + 1, visibleRows.length - 1);
        setSelectedId(visibleRows[next].id);
        return;
      }
      if (e.key === 'k') {
        if (!visibleRows.length) return;
        const prev = selectedIdx <= 0 ? 0 : selectedIdx - 1;
        setSelectedId(visibleRows[prev].id);
        return;
      }

      // Enter opens drawer
      if (e.key === 'Enter' && selectedIdx >= 0 && visibleRows[selectedIdx]) {
        setDrawerRow(visibleRows[selectedIdx]);
        return;
      }

      // Escape closes drawer first
      if (e.key === 'Escape') {
        if (drawerRow) { setDrawerRow(null); return; }
        return;
      }

      // View toggles
      if (e.key === 'f') { setFocus(f => !f); return; }
      if (e.key === 'b') { setBundle(b => !b); return; }

      // Actions on selected row (or drawer row)
      const targetRow = drawerRow || visibleRows[selectedIdx];
      if (!targetRow) return;
      if (e.key === 'e') handleRowAction(targetRow, 'escalate');
      if (e.key === 'r') handleRowAction(targetRow, 'reassign');
      if (e.key === 's') handleRowAction(targetRow, 'snooze');
      if (e.key === 'x') handleRowAction(targetRow, 'resolve');
      if (e.key === 'a') handleRowAction(targetRow, 'assign');
      if (e.key === 'o') handleRowAction(targetRow, 'open');
    };
    document.addEventListener('keydown', kd);
    return () => document.removeEventListener('keydown', kd);
  }, [visibleRows, selectedIdx, drawerRow, handleRowAction, undo, helpOpen, paletteOpen, rulesOpen]);

  // ── Command palette ──────────────────────────────────────────────────────
  const runCommand = useCallback((raw) => {
    if (!raw) return;
    const cmd = raw.trim().toLowerCase();
    const targetRow = drawerRow || visibleRows[selectedIdx];
    if (cmd === '/focus')   return setFocus(f => !f);
    if (cmd === '/bundle')  return setBundle(b => !b);
    if (cmd === '/clear')   { setGroup('all'); setSubSource(null); setFStatus(''); setFCountry([]); setFSla(null); setSearch(''); setFocus(false); setCurrentViewName(null); return; }
    if (cmd === '/export')  return exportCsv(visibleRows, `queue-${new Date().toISOString().slice(0, 10)}.csv`);
    if (cmd.startsWith('/view save')) {
      const name = raw.slice('/view save'.length).trim() || `View ${savedViews.length + 1}`;
      saveView(name);
      return;
    }
    if (cmd.startsWith('/view ')) {
      const name = raw.slice('/view '.length).trim();
      const v = savedViews.find(sv => sv.name.toLowerCase() === name.toLowerCase());
      if (v) applyView(v);
      return;
    }
    if (cmd.startsWith('/snooze')) {
      if (targetRow) handleRowAction(targetRow, 'snooze');
      return;
    }
    if (cmd.startsWith('/reassign')) {
      if (targetRow) handleRowAction(targetRow, 'reassign');
      return;
    }
    if (cmd === '/resolve')   { if (targetRow) handleRowAction(targetRow, 'resolve'); return; }
    if (cmd === '/escalate')  { if (targetRow) handleRowAction(targetRow, 'escalate'); return; }
    if (cmd === '/assign me') { if (targetRow) handleRowAction(targetRow, 'assign'); return; }
    if (cmd === '/open')      { if (targetRow) handleRowAction(targetRow, 'open'); return; }
    addToast?.('error', 'Unknown command', raw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerRow, visibleRows, selectedIdx, savedViews, handleRowAction, addToast]);

  // ── Saved views handlers ────────────────────────────────────────────────
  const saveView = (name) => {
    const view = {
      name, group, subSource, fStatus, fCountry, fSla, sort, search, focus, density, bundle,
    };
    const next = [...savedViews.filter(v => v.name !== name), view];
    setSavedViews(next);
    try { localStorage.setItem('ops_hub_queuev2_views', JSON.stringify(next)); } catch {}
    setCurrentViewName(name);
    addToast?.('success', 'View saved', name);
  };
  const applyView = (v) => {
    setGroup(v.group || 'all');
    setSubSource(v.subSource || null);
    setFStatus(v.fStatus || '');
    setFCountry(v.fCountry || []);
    setFSla(v.fSla || null);
    setSort(v.sort || 'sla');
    setSearch(v.search || '');
    setFocus(!!v.focus);
    if (v.density) setDensity(v.density);
    setBundle(!!v.bundle);
    setCurrentViewName(v.name);
  };
  const deleteView = (name) => {
    const next = savedViews.filter(v => v.name !== name);
    setSavedViews(next);
    try { localStorage.setItem('ops_hub_queuev2_views', JSON.stringify(next)); } catch {}
    if (currentViewName === name) setCurrentViewName(null);
  };

  // ── Shareable URL copy ───────────────────────────────────────────────────
  const copyShareUrl = () => {
    if (typeof window === 'undefined') return;
    const qs = filtersToQuery({ group, subSource, fStatus, fCountry, fSla, sort, search, focus, density, bundle });
    const url = `${window.location.origin}${window.location.pathname}${qs ? '?' + qs : ''}`;
    try {
      navigator.clipboard?.writeText(url);
      addToast?.('success', 'Link copied', 'Shareable URL copied to clipboard');
    } catch {
      addToast?.('info', 'Copy this URL', url);
    }
  };

  // ── Outbound mode (delegated to legacy component) ────────────────────────
  if (queueMode === 'outbound') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {settings.queue_show_inbound_outbound_toggle !== false && (
          <div style={{ padding: '12px 24px', background: 'white', borderBottom: '1px solid #f2f2f2', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'inline-flex', background: '#f7f5f2', borderRadius: 128, padding: 3, gap: 2 }}>
              <button onClick={() => setQueueMode('inbound')} style={modeBtnStyle(false)}>
                <i className="bi-inbox" style={{ marginRight: 5, fontSize: 12 }} />Inbound
              </button>
              <button style={modeBtnStyle(true)}>
                <i className="bi-send" style={{ marginRight: 5, fontSize: 12 }} />Outbound
              </button>
            </div>
          </div>
        )}
        <OutboundQueue requests={requests} setRequests={setRequests} user={user} onNewRequest={onNewRequest} tasks={tasks} />
      </div>
    );
  }

  const subSources = group === 'tasks' ? TASK_SUBSOURCES : group === 'tickets' ? TICKET_SUBSOURCES : [];
  const dateHeader = subSource === 'offboarding' ? 'End Date'
                   : subSource === 'onboarding'  ? 'Start Date'
                   : 'Created';

  const loading = onboardingData.loading || offboardingData.loading || changeRequestData.loading
               || workbenchData.loading || pausedOnboardingData.loading;
  const refreshAll = () => {
    onboardingData.refresh();
    offboardingData.refresh();
    changeRequestData.refresh();
    workbenchData.refresh();
    pausedOnboardingData.refresh();
    queueSync?.refresh?.();
  };

  const hasFiltersActive = !!(fStatus || fCountry.length || fSla || fUnassigned || search || focus || (group !== 'all') || subSource);
  const showInboxZero = !loading && visibleRows.length === 0 && !hasFiltersActive;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Row 1: single header ────────────────────────────────────────── */}
      <div style={{ padding: '10px 24px', background: 'white', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <div style={{ display: 'inline-flex', background: '#f7f5f2', borderRadius: 128, padding: 3, gap: 2 }}>
          {GROUPS.map(g => {
            const active = group === g.id;
            return (
              <button key={g.id} onClick={() => setGroup(g.id)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '5px 14px', borderRadius: 128,
                  border: 'none',
                  background: active ? 'white' : 'transparent',
                  color: active ? '#1b1b1b' : '#616161',
                  fontSize: 13, fontWeight: active ? 700 : 500,
                  cursor: 'pointer', transition: 'all .15s',
                  boxShadow: active ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
                }}>
                <i className={g.icon} style={{ fontSize: 12 }} />
                {g.label}
                <span style={{ padding: '1px 7px', borderRadius: 128, fontSize: 10, fontWeight: 700, background: active ? '#f2f2f2' : 'rgba(0,0,0,0.05)', color: active ? '#1b1b1b' : '#9e9e9e' }}>
                  {counts[g.id] ?? 0}
                </span>
              </button>
            );
          })}
        </div>

        {subSources.length > 0 && (
          <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            {subSources.map(s => {
              const active = subSource === s.id;
              return (
                <button key={s.id} onClick={() => setSubSource(active ? null : s.id)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', borderRadius: 128,
                    border: active ? `1px solid ${s.color}` : '1px solid #e8e8e8',
                    background: active ? `${s.color}12` : 'white',
                    color: active ? s.color : '#616161',
                    fontSize: 11, fontWeight: active ? 600 : 500,
                    cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap',
                  }}>
                  {s.label}
                  <span style={{ fontSize: 10, fontWeight: 700, color: active ? s.color : '#9e9e9e' }}>
                    {subCounts[s.id] || 0}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div style={{ flex: 1 }} />

        {(() => {
          const isLoading = loading || queueSync?.loading;
          const hasErr = sourceErrors.length > 0;
          const color = isLoading ? '#ed8d00' : hasErr ? '#d42d35' : '#29811e';
          const label = isLoading ? 'Syncing' : hasErr ? 'Sync issue' : 'Live';
          const tip = hasErr ? sourceErrors.map(s => `${s.label}: ${s.error}`).join('\n') : label;
          return (
            <div title={tip} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#616161', padding: '0 4px' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, animation: isLoading ? 'pulse 1s infinite' : 'none' }} />
              <span style={{ fontWeight: 600 }}>{label}</span>
              <span style={{ color: '#9e9e9e' }}>· updated {lastSyncAgo}</span>
            </div>
          );
        })()}

        <IconBtn title={twoPane ? 'Switch to overlay drawer' : 'Switch to two-pane layout'} icon={twoPane ? 'bi-layout-split' : 'bi-layout-sidebar-reverse'} onClick={() => setTwoPane(t => !t)} active={twoPane} />
        <IconBtn title={ooo ? 'You are OOO — click to come back' : 'Mark yourself OOO'} icon={ooo ? 'bi-moon-stars-fill' : 'bi-moon-stars'} onClick={() => { const next = !ooo; setOoo(next); setOooState(user?.email, { ooo: next }); }} active={ooo} />
        <IconBtn title="Share current view" icon="bi-link-45deg" onClick={copyShareUrl} />
        <IconBtn title="Export CSV (/export)" icon="bi-download" onClick={() => exportCsv(visibleRows, `queue-${new Date().toISOString().slice(0, 10)}.csv`)} />
        <IconBtn title="Rules" icon="bi-magic" onClick={() => setRulesOpen(true)} />
        <IconBtn title="Shortcuts (?)" icon="bi-keyboard" onClick={() => setHelpOpen(true)} />
        <IconBtn title="Refresh all" icon={loading ? 'bi-arrow-clockwise spin' : 'bi-arrow-clockwise'} onClick={refreshAll} />
      </div>

      {/* ── SLA forecast banner ─────────────────────────────────────────── */}
      {(forecast.breachingIn3h > 0 || forecast.breachingIn24h > 0) && (
        <div style={{
          padding: '8px 24px', background: forecast.breachingIn3h > 0 ? '#fff8e6' : '#f0f7ff',
          borderBottom: `1px solid ${forecast.breachingIn3h > 0 ? '#ffe27c' : '#bddcf0'}`,
          display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, flexShrink: 0,
        }}>
          <i className="bi-hourglass-split" style={{ color: forecast.breachingIn3h > 0 ? '#92400e' : '#1d4ed8', fontSize: 13 }} />
          <span style={{ color: '#1b1b1b', fontWeight: 500 }}>
            SLA forecast:
            {forecast.breachingIn3h > 0 && <strong style={{ color: '#92400e', marginLeft: 6 }}>{forecast.breachingIn3h}</strong>}
            {forecast.breachingIn3h > 0 && <span style={{ color: '#616161' }}> breaching in 3h</span>}
            {forecast.breachingIn3h > 0 && forecast.breachingIn24h > 0 && <span>, </span>}
            {forecast.breachingIn24h > 0 && <strong style={{ color: '#1d4ed8', marginLeft: 2 }}>{forecast.breachingIn24h}</strong>}
            {forecast.breachingIn24h > 0 && <span style={{ color: '#616161' }}> in 24h</span>}
          </span>
          <button onClick={() => { setFSla('at_risk'); setSort('sla'); }}
            style={{ marginLeft: 'auto', padding: '3px 10px', borderRadius: 128, border: '1px solid #e8e8e8', background: 'white', color: '#616161', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>
            Show these
          </button>
        </div>
      )}

      {outsideHours && (
        <div style={{
          padding: '5px 24px', background: '#f7f5f2', borderBottom: '1px solid #f0efed',
          fontSize: 11, color: '#616161', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <i className="bi-moon" style={{ fontSize: 11 }} />
          Outside working hours — rows dimmed, SLA clock still ticks.
        </div>
      )}

      {/* OOO banner with Redistribute action */}
      {ooo && (() => {
        const myRows = visibleRows.filter(r => (r.assigneeEmail || '').toLowerCase() === (user?.email || '').toLowerCase());
        return (
          <div style={{
            padding: '10px 24px', background: '#fff8e6', borderBottom: '1px solid #ffe27c',
            display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, flexShrink: 0,
          }}>
            <i className="bi-moon-stars-fill" style={{ color: '#92400e', fontSize: 13 }} />
            <span style={{ color: '#1b1b1b', fontWeight: 500 }}>
              You're marked OOO.
              <strong style={{ marginLeft: 4 }}>{myRows.length}</strong> of your rows are open — redistribute so nothing stalls.
            </span>
            <div style={{ flex: 1 }} />
            <button onClick={() => {
              // Non-destructive: show a summary toast and focus the unassigned list.
              // Full redistribution requires backend; surface the intent for now.
              addToast?.('info', 'Redistribute drafted',
                `${myRows.length} rows flagged. Assign or reassign individually from the drawer, or confirm in your next sync.`);
              setFUnassigned(false);
            }}
              style={{ padding: '5px 12px', borderRadius: 128, border: 'none', background: '#92400e', color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              <i className="bi-arrow-left-right" style={{ marginRight: 5 }} />Redistribute {myRows.length}
            </button>
          </div>
        );
      })()}

      {/* Per-source transparent failure */}
      {sourceErrors.length > 0 && (
        <div style={{
          padding: '8px 24px', background: '#fef2f2', borderBottom: '1px solid #fca5a5',
          display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, flexShrink: 0, flexWrap: 'wrap',
        }}>
          <i className="bi-exclamation-triangle-fill" style={{ color: '#d42d35', fontSize: 13 }} />
          <span style={{ color: '#991b1b', fontWeight: 500 }}>Sync issues:</span>
          {sourceErrors.map(s => (
            <span key={s.source} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px', borderRadius: 128, background: 'white', border: '1px solid #fca5a5', color: '#991b1b', fontSize: 11, fontWeight: 500 }}
              title={s.error}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#d42d35' }} />
              {s.label}
              {s.retry && (
                <button onClick={s.retry} title="Retry" style={{ marginLeft: 4, padding: '0 6px', borderRadius: 128, border: 'none', background: '#d42d35', color: 'white', fontSize: 10, fontWeight: 600, cursor: 'pointer', height: 18 }}>
                  Retry
                </button>
              )}
            </span>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={refreshAll} style={{ padding: '4px 10px', borderRadius: 128, border: '1px solid #fca5a5', background: 'white', color: '#991b1b', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            Retry all
          </button>
        </div>
      )}

      {/* ── Saved views ─────────────────────────────────────────────────── */}
      <SavedViewsStrip
        views={savedViews}
        currentName={currentViewName}
        onApply={applyView}
        onSave={saveView}
        onDelete={deleteView}
      />

      {/* ── Row 2: filter bar ──────────────────────────────────────────── */}
      <div style={{ padding: '8px 24px', background: 'white', borderBottom: '1px solid #f0efed', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'nowrap' }}>
        <select value={fStatus} onChange={e => setFStatus(e.target.value)} style={selectStyle(!!fStatus)}>
          <option value="">All statuses</option>
          <option value="critical">Critical</option>
          <option value="active">Active</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>

        <CountryFilter options={countryOptions} value={fCountry} onChange={setFCountry} />

        {['breached', 'at_risk', 'ok'].map(sev => {
          const active = fSla === sev;
          const label = sev === 'breached' ? 'Breached' : sev === 'at_risk' ? 'At risk' : 'On track';
          const color = sev === 'breached' ? '#d42d35' : sev === 'at_risk' ? '#ed8d00' : '#15803d';
          return (
            <button key={sev} onClick={() => setFSla(active ? null : sev)}
              style={{
                padding: '5px 10px', borderRadius: 128,
                border: active ? `1px solid ${color}` : '1px solid #e8e8e8',
                background: active ? `${color}12` : 'white',
                color: active ? color : '#616161',
                fontSize: 11, fontWeight: active ? 600 : 500,
                cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap',
              }}>
              {label}
            </button>
          );
        })}

        <div style={{ width: 1, height: 20, background: '#e8e8e8', margin: '0 2px' }} />

        <ToggleBtn active={focus} onClick={() => setFocus(f => !f)} icon="bi-bullseye" label="Focus" activeColor="#7c3aed" title="Show only at-risk and breached rows (f)" />
        <ToggleBtn active={bundle} onClick={() => setBundle(b => !b)} icon="bi-people" label="Bundle" activeColor="#1d4ed8" title="Group rows by employee (b)" />
        <ToggleBtn active={fUnassigned} onClick={() => setFUnassigned(!fUnassigned)} icon="bi-person-dash" label="Unassigned" activeColor="#d42d35" />

        <select value={density} onChange={e => setDensity(e.target.value)} style={selectStyle(false)} title="Row density">
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
          <option value="cozy">Cozy</option>
        </select>

        <select value={sort} onChange={e => setSort(e.target.value)} style={selectStyle(false)}>
          <option value="sla">Sort: SLA urgency</option>
          <option value="oldest">Sort: Oldest first</option>
          <option value="newest">Sort: Newest first</option>
        </select>

        <div style={{ flex: 1 }} />

        <div style={{ position: 'relative' }}>
          <i className="bi-search" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#9e9e9e' }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search…  (/ for commands)"
            style={{ width: 240, height: 30, paddingLeft: 30, paddingRight: 10, borderRadius: 8, border: '1px solid #e8e8e8', fontSize: 12, outline: 'none' }} />
        </div>

        <span style={{ fontSize: 11, color: '#9e9e9e', whiteSpace: 'nowrap' }}>
          {visibleRows.length} {visibleRows.length === 1 ? 'row' : 'rows'}
        </span>
      </div>

      {/* ── Table + optional docked drawer (two-pane) ────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <ErrorBoundary>
            <SourceTableV2
              items={items}
              loading={loading}
              error={null}
              onRefresh={refreshAll}
              onRowClick={handleRowClick}
              onQuickAction={handleRowAction}
              selectedId={selectedId}
              emptyLabel={showInboxZero ? 'Inbox zero 🎯' : hasFiltersActive ? 'No matches' : 'Queue is clear'}
              emptySubLabel={showInboxZero
                ? `${counts.all} total handled. Take a breath and enjoy it.`
                : hasFiltersActive ? 'Try adjusting filters — or / to run a command.' : 'All caught up'}
              emptyCelebrate={showInboxZero}
              showSourceColumn={group === 'all' || !subSource}
              dateHeader={dateHeader}
              currentUser={user}
              density={density}
              dimOutsideHours={outsideHours}
              newIds={newIds}
              presence={presence}
            />
          </ErrorBoundary>
        </div>
        {twoPane && (
          <QueueV2Drawer
            row={drawerRow}
            onClose={() => setDrawerRow(null)}
            onAction={(id) => drawerRow && handleRowAction(drawerRow, id)}
            currentUser={user}
            perms={perms}
            docked
          />
        )}
      </div>

      {/* ── Overlay drawer (when two-pane is off) ───────────────────── */}
      {!twoPane && (
        <QueueV2Drawer
          row={drawerRow}
          onClose={() => setDrawerRow(null)}
          onAction={(id) => drawerRow && handleRowAction(drawerRow, id)}
          currentUser={user}
          perms={perms}
        />
      )}

      {/* ── Overlays ───────────────────────────────────────────────────── */}
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onCommand={runCommand}
        savedViews={savedViews}
        selected={drawerRow || visibleRows[selectedIdx] || null}
      />
      <RulesEditor
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
        rules={rules}
        onSave={(next) => { setRules(next); saveRules(next); addToast?.('success', 'Rules saved', `${next.length} rule${next.length === 1 ? '' : 's'}`); }}
      />

      {/* ── Undo toast ───────────────────────────────────────────────── */}
      {undo && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 600, display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 16px', borderRadius: 128,
          background: '#1b1b1b', color: 'white',
          boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
          fontSize: 13,
          animation: 'slideUp .2s ease-out',
        }}>
          <i className="bi-check-circle-fill" style={{ color: '#9adf6e' }} />
          <span>{undo.message}</span>
          <button onClick={() => {
            undo.revert?.();
            setUndo(null);
            if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
          }}
            style={{ padding: '4px 12px', borderRadius: 128, border: 'none', background: 'rgba(255,255,255,0.12)', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Undo
          </button>
        </div>
      )}
    </div>
  );
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function IconBtn({ title, icon, onClick, active }) {
  return (
    <button onClick={onClick} title={title}
      style={{ width: 32, height: 32, borderRadius: 8, border: active ? '1px solid #1f74b3' : '1px solid #e8e8e8', background: active ? '#eff6ff' : 'white', color: active ? '#1f74b3' : '#9e9e9e', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <i className={icon} style={{ fontSize: 13 }} />
    </button>
  );
}

function ToggleBtn({ active, onClick, icon, label, activeColor = '#1f74b3', title }) {
  return (
    <button onClick={onClick} title={title}
      style={{
        padding: '5px 10px', borderRadius: 8,
        border: active ? `1px solid ${activeColor}` : '1px solid #e8e8e8',
        background: active ? activeColor + '12' : 'white',
        color: active ? activeColor : '#616161',
        fontSize: 11, fontWeight: active ? 600 : 500,
        cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
      <i className={icon} style={{ fontSize: 11, marginRight: 4 }} />{label}
    </button>
  );
}

function CountryFilter({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const active = value.length > 0;
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{
          padding: '5px 10px', borderRadius: 8,
          border: active ? '1px solid #1f74b3' : '1px solid #e8e8e8',
          background: active ? '#eff6ff' : 'white',
          color: active ? '#1f74b3' : '#616161',
          fontSize: 11, fontWeight: active ? 600 : 500,
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}>
        <i className="bi-geo-alt" style={{ fontSize: 10, marginRight: 4 }} />
        {active ? `${value.length} countries` : 'All countries'}
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 100 }} />
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: 'white', border: '1px solid #e8e8e8', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,.08)', padding: 6, zIndex: 101, minWidth: 200, maxHeight: 280, overflowY: 'auto' }}>
            {value.length > 0 && (
              <button onClick={() => onChange([])} style={{ width: '100%', padding: '4px 8px', borderRadius: 6, border: 'none', background: 'transparent', color: '#9e9e9e', fontSize: 11, cursor: 'pointer', textAlign: 'left' }}>
                Clear
              </button>
            )}
            {options.length === 0 && (<div style={{ padding: 8, fontSize: 11, color: '#9e9e9e' }}>No countries</div>)}
            {options.map(c => {
              const selected = value.includes(c);
              return (
                <div key={c} onClick={() => onChange(selected ? value.filter(v => v !== c) : [...value, c])}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', background: selected ? '#eff6ff' : 'transparent', fontSize: 12 }}>
                  <input type="checkbox" checked={selected} readOnly style={{ accentColor: '#1f74b3' }} />
                  <span>{getFlag(c)}</span>
                  <span style={{ color: '#1b1b1b' }}>{getCountryName(c) || c}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const selectStyle = (active) => ({
  height: 30, padding: '0 10px', borderRadius: 8,
  border: active ? '1px solid #1f74b3' : '1px solid #e8e8e8',
  background: active ? '#eff6ff' : 'white',
  color: active ? '#1f74b3' : '#616161',
  fontSize: 11, fontWeight: active ? 600 : 500,
  cursor: 'pointer', outline: 'none',
});

function formatAgo(ts, now) {
  if (!ts) return 'never';
  const diff = Math.max(0, (now || Date.now()) - ts);
  if (diff < 10_000) return 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr${hr === 1 ? '' : 's'} ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

const modeBtnStyle = (active) => ({
  padding: '5px 16px', borderRadius: 128, fontSize: 13,
  fontWeight: active ? 600 : 500,
  border: 'none',
  background: active ? 'white' : 'transparent',
  color: active ? '#1b1b1b' : '#616161',
  cursor: 'pointer',
  boxShadow: active ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
});

export default QueueV2;
