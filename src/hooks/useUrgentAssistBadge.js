// ── useUrgentAssistBadge ──────────────────────────────────────────────────
// Lightweight count of "things assigned to me on Urgent Assist that I still
// owe action on" — the red number that lives on the top-nav Urgent Assist
// tab. Counts items where:
//   • assignee_email = viewer (My Requests scope)
//   • status ∈ { new, in_progress, on_hold }   (excludes resolved)
//
// Two data sources:
//   1. Manual rows  — fetch /api/v1/urgent-assist?scope=mine&limit=200
//      and filter status client-side. Polls every 60 s + on visibility
//      change. The list endpoint already returns only assignee=me rows
//      under the mine scope, so we just count the non-resolved ones.
//   2. Workbench rows — the caller passes `workbenchTasks` (typically
//      `queueUnified.workbenchData.tasks` from IntegrationsContext).
//      We filter to urgent-assist task types + assignee=viewer here so
//      the hook works without re-reading context.
//
// Returns the total count. Safe to read on every render — internal state
// is debounced so a polling tick doesn't trigger callers' re-renders
// when the count is stable.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listUrgentAssist } from '../services/urgentAssistApi';
import { isUrgentAssistTaskType } from '../lib/urgent-assist-task-types';

const TICK_MS = 60_000;

const NON_RESOLVED = new Set(['new', 'in_progress', 'on_hold']);

// Map upstream Deel status strings to the same four-status model used on
// the Urgent Assist tab. Mirrors useUrgentAssistData.workbenchStatusToTab.
function workbenchStatusIsActionable(upstream) {
  switch (upstream) {
    case 'TO_DO':
    case 'IN_PROGRESS':
    case 'ON_HOLD':
    case 'ESCALATED':
      return true;
    case 'COMPLETED':
    case 'CLOSED':
    default:
      return false;
  }
}

export function useUrgentAssistBadge({ enabled = true, userEmail = '', workbenchTasks = [] } = {}) {
  const [manualCount, setManualCount] = useState(0);
  const seqRef = useRef(0);
  const lcEmail = (userEmail || '').toLowerCase();

  // Manual-row count — polls /api/v1/urgent-assist?scope=mine.
  const refresh = useCallback(async () => {
    if (!enabled || !lcEmail) return;
    const seq = ++seqRef.current;
    try {
      const res = await listUrgentAssist({ scope: 'mine', limit: 200 });
      if (seq !== seqRef.current) return;
      const items = Array.isArray(res?.items) ? res.items : [];
      const c = items.reduce((acc, i) => acc + (NON_RESOLVED.has(i?.status) ? 1 : 0), 0);
      setManualCount(c);
    } catch {
      // Preserve previous count on transient error — same stale-while-
      // revalidate pattern the queue hooks use.
      if (seq !== seqRef.current) return;
    }
  }, [enabled, lcEmail]);

  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      refresh();
    }, TICK_MS);
    const onVis = () => { if (typeof document !== 'undefined' && !document.hidden) refresh(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  }, [enabled, refresh]);

  // Workbench-row count — derived from the context-provided tasks list.
  // No network call here; useWorkbenchData already polls on the queue
  // boundary so we just consume what's there.
  const workbenchCount = useMemo(() => {
    if (!enabled || !lcEmail) return 0;
    let c = 0;
    for (const t of (workbenchTasks || [])) {
      if (!t) continue;
      if (!(isUrgentAssistTaskType(t.taskType) || isUrgentAssistTaskType(t.sourceType))) continue;
      const ae = (t.assignee?.email || '').toLowerCase();
      if (ae !== lcEmail) continue;
      if (workbenchStatusIsActionable(t.status)) c++;
    }
    return c;
  }, [enabled, lcEmail, workbenchTasks]);

  return manualCount + workbenchCount;
}
