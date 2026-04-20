// ── GET /api/v1/integrations/deel/workbench ────────────────────────────────
// Proxies to Deel Admin API: OpsWorkbench tasks (HRX actionable).
// Uses /admin/ops_workbench/tasks
// Response: { count, result: [...], cursor }
// Uses persistent cache + stale-while-revalidate.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listWorkbenchTasks, isDeelConfigured } from '../../../../../../src/lib/deel-api';
import { cacheGet, cacheSet } from '../../../../../../src/lib/server-cache';
import { scopeWorkbenchTasks } from '../../../../../../src/lib/queue-scoping';

const CACHE_KEY = 'deel_workbench';
const CACHE_TTL = 3 * 60 * 1000;    // fresh for 3 minutes
const STALE_TTL = 30 * 60 * 1000;   // serve stale up to 30 minutes

function scoped(data, user) {
  if (!data?.items) return data;
  const items = scopeWorkbenchTasks(data.items, user);
  return { ...data, items, total: items.length };
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isDeelConfigured()) {
    return NextResponse.json({ error: 'Deel API not configured' }, { status: 503 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const bustCache = searchParams.get('bust') === '1';
    const limit = searchParams.get('limit') || '50';

    if (!bustCache) {
      const fresh = cacheGet(CACHE_KEY, CACHE_TTL);
      if (fresh) return NextResponse.json(scoped(fresh, user));
    }

    let responseData;
    try {
      const result = await listWorkbenchTasks({ limit: parseInt(limit, 10) });

      // Derive display status for each task
      const items = result.items.map(t => ({
        ...t,
        displayStatus: deriveWorkbenchStatus(t),
      }));

      responseData = { items, total: result.total };
      cacheSet(CACHE_KEY, responseData);
    } catch (fetchErr) {
      const stale = cacheGet(CACHE_KEY, STALE_TTL);
      if (stale) {
        console.warn('[workbench] Fetch failed, returning stale cache:', fetchErr.message);
        return NextResponse.json({ ...scoped(stale, user), _stale: true });
      }
      throw fetchErr;
    }

    return NextResponse.json(scoped(responseData, user));
  } catch (err) {
    console.error('[integrations/deel/workbench]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: err.status || 500 });
  }
}

/**
 * Derive display label + severity from workbench task status.
 */
function deriveWorkbenchStatus(task) {
  const status = (task.status || '').toUpperCase();
  const sla = task.slaBreachStatus || '';

  // SLA-breached tasks are always critical
  if (sla === 'SLA_BREACHED')
    return { label: statusLabel(status), severity: 'critical', color: '#d42d35' };

  switch (status) {
    case 'ESCALATED':
      return { label: 'Escalated', severity: 'critical', color: '#d42d35' };
    case 'TO_DO':
      return { label: 'To Do', severity: 'warning', color: '#ed8d00' };
    case 'IN_PROGRESS':
      return { label: 'In Progress', severity: 'active', color: '#1d4ed8' };
    case 'ON_HOLD':
      return { label: 'On Hold', severity: 'info', color: '#616161' };
    case 'COMPLETED':
      return { label: 'Completed', severity: 'info', color: '#29811e' };
    case 'CLOSED':
      return { label: 'Closed', severity: 'info', color: '#9e9e9e' };
    default:
      return { label: status || 'Unknown', severity: 'info', color: '#616161' };
  }
}

function statusLabel(status) {
  const map = {
    TO_DO: 'To Do',
    IN_PROGRESS: 'In Progress',
    ON_HOLD: 'On Hold',
    ESCALATED: 'Escalated',
    COMPLETED: 'Completed',
    CLOSED: 'Closed',
  };
  return map[status] || status;
}
