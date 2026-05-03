// ── useUrgentAssistData ───────────────────────────────────────────────────
// Aggregates two sources into one normalised "urgent assist" feed:
//
//   1. Workbench-sourced — taskType matches "HRX Urgent Assist Request" or
//      "HRX Urgent Assist". Read from the shared queueUnified.workbenchData
//      (already pre-warmed at the App.jsx boundary so this hook adds zero
//      network requests on top of what Queue is already paying for).
//
//   2. Manual-sourced — rows in `urgent_assist_request` Postgres table,
//      fetched via /api/v1/urgent-assist with scope=mine|team|all.
//
// Both shapes are normalised into a single row contract so the UI table
// renders them uniformly. SLA is identical for both: 6 biz hours from
// createdAt — workbench rows IGNORE the upstream Deel slaRemaining (which
// is task-config dependent and varies per task type) so the SLA band on
// this tab reflects the operating spec, not Deel's per-task config.

import { useEffect, useMemo, useState, useCallback, useRef, useContext } from 'react';
import { listUrgentAssist } from '../services/urgentAssistApi';
import { isUrgentAssistTaskType } from '../lib/urgent-assist-task-types';
import { IntegrationsContext } from '../App';
import { elapsedBizMs } from '../utils/bizTime';

// Operating-spec SLA — six BUSINESS HOURS from createdAt (Sat/Sun excluded).
// Tunable here in one place; if the team later wants the SLA dial to be
// editable from the Team-tab settings table we can switch this constant
// to read from useQueueSlaSettings.
const SLA_WINDOW_MS = 6 * 60 * 60 * 1000;

const STATUS_LABEL = {
  new:         { label: 'New',         severity: 'warning', color: '#0369a1' },
  in_progress: { label: 'In Progress', severity: 'active',  color: '#1d4ed8' },
  on_hold:     { label: 'On Hold',     severity: 'info',    color: '#737373' },
  resolved:    { label: 'Resolved',    severity: 'info',    color: '#15803d' },
};

// Map a Deel workbench upstream status onto the four-status model used by
// this tab. ESCALATED bubbles into "in_progress" — the work is happening,
// it's just been flagged urgent (the SLA pill conveys urgency separately).
function workbenchStatusToTabStatus(upstreamStatus) {
  switch (upstreamStatus) {
    case 'TO_DO':       return 'new';
    case 'IN_PROGRESS': return 'in_progress';
    case 'ON_HOLD':     return 'on_hold';
    case 'ESCALATED':   return 'in_progress';
    case 'COMPLETED':   return 'resolved';
    case 'CLOSED':      return 'resolved';
    default:            return 'new';
  }
}

function computeSla(createdAt) {
  if (!createdAt) return { slaRemaining: null, slaBreachStatus: null, slaWindowMs: SLA_WINDOW_MS };
  const ts = new Date(createdAt).getTime();
  if (!Number.isFinite(ts) || ts <= 0) {
    return { slaRemaining: null, slaBreachStatus: null, slaWindowMs: SLA_WINDOW_MS };
  }
  const remainingMs = SLA_WINDOW_MS - elapsedBizMs(ts, Date.now());
  return {
    slaRemaining: Math.round(remainingMs / 1000),
    slaBreachStatus: remainingMs < 0 ? 'SLA_BREACHED' : 'SLA_NOT_BREACHED',
    slaWindowMs: SLA_WINDOW_MS,
  };
}

// Workbench task → unified urgent-assist row.
function fromWorkbench(task) {
  const status = workbenchStatusToTabStatus(task.status);
  const sla = computeSla(task.createdAt);
  return {
    id: `wb:${task.id}`,
    rawId: String(task.id || ''),
    source: 'workbench',
    subject: task.name || 'Untitled Task',
    requestType: task.taskType || 'HRX Urgent Assist',
    country: task.country || '',
    assigneeEmail: (task.assignee?.email || '').toLowerCase(),
    assigneeName: task.assignee?.name || '',
    createdByEmail: (task.creator?.email || '').toLowerCase(),
    createdByName: task.creator?.name || '',
    linkUrl: `https://admin.deel.network/ops-workbench/${encodeURIComponent(task.id)}?teamIds%5B%5D=f235fd21-c5a0-4804-badf-2cc3dc76191e`,
    description: task.description || '',
    status,
    statusBadge: STATUS_LABEL[status] || STATUS_LABEL.new,
    priority: task.highPriority ? 'high' : 'medium',
    createdAt: task.createdAt || '',
    updatedAt: task.updatedAt || task.createdAt || '',
    resolvedAt: task.completedAt || null,
    slaRemaining: sla.slaRemaining,
    slaBreachStatus: sla.slaBreachStatus,
    slaWindowMs: sla.slaWindowMs,
    isManual: false,
  };
}

// Manual DB row → unified urgent-assist row.
function fromManual(row) {
  const sla = computeSla(row.createdAt);
  return {
    id: `m:${row.id}`,
    rawId: row.id,
    source: 'manual',
    subject: row.subject,
    requestType: row.requestType || 'HRX Urgent Assist Request',
    country: row.country || '',
    assigneeEmail: (row.assigneeEmail || '').toLowerCase(),
    assigneeName: row.assigneeName || '',
    createdByEmail: (row.createdByEmail || '').toLowerCase(),
    createdByName: row.createdByName || '',
    linkUrl: row.linkUrl || '',
    description: row.description || '',
    status: row.status,
    statusBadge: STATUS_LABEL[row.status] || STATUS_LABEL.new,
    priority: row.priority || 'high',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || row.createdAt || '',
    resolvedAt: row.resolvedAt || null,
    slaRemaining: sla.slaRemaining,
    slaBreachStatus: sla.slaBreachStatus,
    slaWindowMs: sla.slaWindowMs,
    isManual: true,
  };
}

/**
 * useUrgentAssistData — main hook for the Urgent Assist tab.
 *
 * @param {Object}  opts
 * @param {string}  opts.scope      — 'mine' | 'team' | 'all' (controls both
 *                                    DB filter and workbench filter)
 * @param {string}  opts.userEmail  — viewer's email (lowercased FE-side)
 * @param {boolean} opts.isManager  — TL/RM/Admin? (controls whether
 *                                    workbench rows pass the team filter)
 * @param {Set<string>} opts.teamEmails — emails the viewer "manages" (TL: direct
 *                                    reports; RM: full subtree). Used for
 *                                    workbench rows when scope==='team'.
 * @param {boolean} opts.isAdmin    — admin sees all workbench rows on
 *                                    scope='all'; non-admin still narrows
 *                                    to their visible chain even on 'all'.
 */
export function useUrgentAssistData({
  scope = 'mine',
  userEmail = '',
  isManager = false,
  isAdmin = false,
  teamEmails = null,
  visibleEmails = null,
} = {}) {
  const { queueUnified } = useContext(IntegrationsContext) || {};
  const workbenchData = queueUnified?.workbenchData || { tasks: [], loading: false, error: null };

  // ── Manual rows from /api/v1/urgent-assist ──
  const [manualRows, setManualRows] = useState([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState(null);
  const reqSeqRef = useRef(0);

  const loadManual = useCallback(async () => {
    const seq = ++reqSeqRef.current;
    setManualLoading(true);
    setManualError(null);
    try {
      const res = await listUrgentAssist({ scope, limit: 200 });
      if (seq !== reqSeqRef.current) return;
      setManualRows(res?.items || []);
    } catch (err) {
      if (seq !== reqSeqRef.current) return;
      // Surface the error but PRESERVE the previous rows so a transient
      // 5xx / VPN hiccup doesn't blank out the table mid-shift. Mirrors the
      // stale-while-revalidate behaviour used by useWorkbenchData et al.
      setManualError(err?.message || 'Could not load urgent assist requests');
    } finally {
      if (seq === reqSeqRef.current) setManualLoading(false);
    }
  }, [scope]);

  useEffect(() => { loadManual(); }, [loadManual]);

  // ── Workbench rows — filter to the urgent-assist task types ──
  // Then apply scope. Mine: assignee or creator = me. Team (manager only):
  // assignee in my team. All: passes through.
  const lcUser = (userEmail || '').toLowerCase();
  const workbenchUrgent = useMemo(() => {
    const tasks = Array.isArray(workbenchData.tasks) ? workbenchData.tasks : [];
    const matched = tasks.filter(t => isUrgentAssistTaskType(t?.taskType) || isUrgentAssistTaskType(t?.sourceType));
    if (scope === 'all') {
      if (isAdmin) return matched;
      // Non-admin "all" — narrow to their visible chain so we don't surface
      // tickets they have no operational relationship with.
      if (visibleEmails) {
        return matched.filter(t => {
          const ae = (t.assignee?.email || '').toLowerCase();
          if (ae && visibleEmails.has(ae)) return true;
          const ce = (t.creator?.email || '').toLowerCase();
          if (ce && visibleEmails.has(ce)) return true;
          return false;
        });
      }
      return matched;
    }
    // Per the 2026-05-03 spec: "my requests = any request where I'm
    // assigned" — workbench-sourced rows now match on `assignee.email`
    // ONLY (no creator-OR fallback). Same rule for Team (assignee in
    // the manager's team subtree) and the role-collapsed agent path.
    if (scope === 'team') {
      if (!isManager) {
        // Agents asking for team collapse to mine — same rule the API uses.
        return matched.filter(t => (t.assignee?.email || '').toLowerCase() === lcUser);
      }
      const team = teamEmails || new Set();
      return matched.filter(t => {
        const ae = (t.assignee?.email || '').toLowerCase();
        return ae && (ae === lcUser || team.has(ae));
      });
    }
    // mine — assignee match only, per spec.
    return matched.filter(t => (t.assignee?.email || '').toLowerCase() === lcUser);
  }, [workbenchData.tasks, scope, lcUser, isManager, isAdmin, teamEmails, visibleEmails]);

  const items = useMemo(() => {
    const out = [];
    for (const t of workbenchUrgent) out.push(fromWorkbench(t));
    for (const r of manualRows) out.push(fromManual(r));
    // Default order: SLA tier (breached → at-risk → on-track), oldest first
    // within tier — same shape Queue + SourceTable use elsewhere.
    const tier = (row) => {
      if (row.slaBreachStatus === 'SLA_BREACHED') return 0;
      if (typeof row.slaRemaining === 'number' && row.slaRemaining > 0
          && Number.isFinite(row.slaWindowMs)
          && row.slaRemaining < (row.slaWindowMs / 1000) / 4) return 1;
      return 2;
    };
    out.sort((a, b) => {
      const ta = tier(a), tb = tier(b);
      if (ta !== tb) return ta - tb;
      const am = a.createdAt ? new Date(a.createdAt).getTime() : Number.POSITIVE_INFINITY;
      const bm = b.createdAt ? new Date(b.createdAt).getTime() : Number.POSITIVE_INFINITY;
      return am - bm;
    });
    return out;
  }, [workbenchUrgent, manualRows]);

  // Status counts — mirror HR Hub's status card pattern. Reflects the
  // post-scope set so the four cards stay in sync with the table.
  const statusCounts = useMemo(() => {
    const c = { new: 0, in_progress: 0, on_hold: 0, resolved: 0, total: items.length };
    for (const r of items) {
      if (c[r.status] != null) c[r.status]++;
    }
    return c;
  }, [items]);

  return {
    items,
    statusCounts,
    loading: !!(workbenchData.loading || manualLoading),
    error: workbenchData.error || manualError || null,
    refresh: useCallback(() => {
      loadManual();
      try { workbenchData.refresh?.(); } catch {}
    }, [loadManual, workbenchData]),
    // Surface so the view can call back after a create/edit/delete.
    refreshManual: loadManual,
  };
}
