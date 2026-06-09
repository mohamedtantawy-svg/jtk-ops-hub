// ── GET /api/v1/integrations/deel/redlines ─────────────────────────────────────
// Proxies to Deel Admin API: redline requests.
// Uses /admin/eor-experience/redline-requests
// Default: fetches both Legal Review + HRX Execution buckets concurrently
// (paginated via cursor) and merges — FE splits by isExecution.
// Response: { items: [...], total }
// Uses persistent cache + stale-while-revalidate.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listRedlineRequests, isDeelConfigured } from '../../../../../../src/lib/deel-api';
import { getCurrentDeptSlugAndId } from '../../../../../../src/lib/dept-scope';
import { isDeelSourceVisible } from '../../../../../../src/lib/dept-integrations';
import { cacheGet, cacheSet } from '../../../../../../src/lib/server-cache';
import { scopeRedlineRequests } from '../../../../../../src/lib/queue-scoping';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import { buildWithTimeout } from '../../../../../../src/lib/scan-timeout';
import { getReassignmentMap, applyReassignments } from '../../../../../../src/lib/queue-reassignments';
import { getWorkbenchAssigneesByTaskIds } from '../../../../../../src/lib/workbench-resolution-state';
import { MEMBERS_BY_EMAIL } from '../../../../../../src/data/members';

// Default: both Review (legalReview) and Execution (HRXToExecute) buckets —
// the two "Action Needed" surfaces on admin.deel.network.
const DEFAULT_STATUSES = [
  'preparingDocuments.legalReview',
  'preparingDocuments.HRXToExecute',
];

const CACHE_KEY = 'deel_redlines_v2';
const CACHE_TTL = 5 * 60 * 1000;    // fresh for 5 minutes
const STALE_TTL = 30 * 60 * 1000;   // serve stale up to 30 minutes
const SCAN_TIMEOUT_MS = 45_000;

function scoped(data, user, overrideMap) {
  if (!data?.items) return data;
  const overlaid = applyReassignments(data.items, overrideMap);
  const items = scopeRedlineRequests(overlaid, user);
  return { ...data, items, total: items.length };
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Phase 13a: dept-isolated visibility gate.
  {
    const deptInfo = await getCurrentDeptSlugAndId(user, req);
    if (!isDeelSourceVisible(deptInfo?.deptSlug, 'redlines')) {
      return NextResponse.json({ items: [], total: 0, disabled: true, reason: 'source-disabled-for-dept' });
    }
  }
  if (!isDeelConfigured()) {
    return NextResponse.json({ error: 'Deel API not configured' }, { status: 503 });
  }

  // Hydrate the server roster before scopeRedlineRequests runs.
  await ensureRosterHydrated();
  const overrideMap = await getReassignmentMap('redlines');

  try {
    const { searchParams } = new URL(req.url);
    // Accept comma-joined status string (legacy) or fall back to default set.
    const statusParam = searchParams.get('status');
    const statuses = statusParam
      ? statusParam.split(',').map(s => s.trim()).filter(Boolean)
      : DEFAULT_STATUSES;
    const bustCache = searchParams.get('bust') === '1';

    const cacheKeyFull = `${CACHE_KEY}_${statuses.join('|').replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    if (!bustCache) {
      const fresh = cacheGet(cacheKeyFull, CACHE_TTL);
      if (fresh) return NextResponse.json(scoped(fresh, user, overrideMap));
    }

    let responseData;
    try {
      const r = await buildWithTimeout(cacheKeyFull, async () => {
        const result = await listRedlineRequests({ status: statuses });
        const items = result.items.map(rr => ({
          ...rr,
          displayStatus: deriveRedlineStatus(rr),
        }));
        await adoptWorkbenchOwners(items);
        return { items, total: result.total };
      }, { timeoutMs: SCAN_TIMEOUT_MS, staleTtl: STALE_TTL });
      if (r.result == null) {
        return NextResponse.json(
          { error: 'Redlines scan timed out — please retry', _timeout: true },
          { status: 504 },
        );
      }
      if (r.timedOut) {
        console.warn('[redlines] Live build exceeded %dms — serving stale cache', SCAN_TIMEOUT_MS);
        return NextResponse.json({ ...scoped(r.result, user, overrideMap), _stale: true, _stale_reason: 'timeout' });
      }
      responseData = r.result;
    } catch (fetchErr) {
      const stale = cacheGet(cacheKeyFull, STALE_TTL);
      if (stale) {
        console.warn('[redlines] Fetch failed, returning stale cache:', fetchErr.message);
        return NextResponse.json({ ...scoped(stale, user, overrideMap), _stale: true, _stale_reason: 'error' });
      }
      throw fetchErr;
    }

    return NextResponse.json(scoped(responseData, user, overrideMap));
  } catch (err) {
    console.error('[integrations/deel/redlines]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: err.status || 500 });
  }
}

/**
 * Adopt the workbench ticket's owner as the redline's assignee.
 *
 * Redlines carry no upstream assignee of their own, so Ops Hub otherwise
 * synthesises a country owner (round-robin in normalizeSourceRows). But most
 * redlines already have a workbench task assigned to the real owner — Jojo
 * Zhao's "task assignee mismatch" report: the WB task was assigned to Shell
 * while Ops Hub showed Jojo (the synthesised country owner). When the redline's
 * workbench task is assigned to a known Ops Hub member, adopt that person as
 * the row's assignee so it attributes, scopes, and displays to them — matching
 * Deel.
 *
 * Precedence (highest first): manual in-app reassignment > workbench owner >
 * country owner. This stamps `assigneeEmail` in the CACHED builder, which runs
 * BEFORE `scoped()` overlays any `queue_reassignments` override via
 * applyReassignments — so a manual Ops Hub reassignment still wins. Rows with
 * no workbench task, an unassigned task, or an assignee who isn't an Ops Hub
 * member are left untouched, so the FE keeps synthesising the country owner.
 *
 * Resolution per row: the assignee email embedded on the redline's workbench
 * task (rare — usually only an id is present) → the persistent workbench
 * snapshot (`workbench_known_tasks`) keyed by the workbench task id. A snapshot
 * miss is silent and harmless (falls back to country owner).
 *
 * Mutates `items` in place. Sets `assigneeIsSynthetic`-clearing fields via the
 * normaliser downstream (a populated `assigneeEmail` makes the row non-synthetic).
 */
async function adoptWorkbenchOwners(items) {
  if (!Array.isArray(items) || items.length === 0) return;
  const taskIds = items.map(r => r.workbenchTaskId).filter(Boolean);
  const snap = await getWorkbenchAssigneesByTaskIds(taskIds);
  let adopted = 0;
  for (const r of items) {
    const direct = (r.workbenchAssigneeEmail || '').toLowerCase();
    const fromSnap = r.workbenchTaskId ? snap.get(String(r.workbenchTaskId)) : null;
    const email = direct || fromSnap?.email || '';
    if (!email) continue;
    const member = MEMBERS_BY_EMAIL[email];
    if (!member) continue;          // unknown to Ops Hub — keep the country owner
    r.assigneeEmail = email;
    r.assignee = (direct ? r.workbenchAssigneeName : fromSnap?.name) || member.name || email;
    r.assigneeFromWorkbench = true; // provenance for debugging / future UI
    adopted++;
  }
  console.log(`[redlines] adopted workbench owner on ${adopted}/${items.length} redlines (rest fall back to the country owner)`);
}

/**
 * Derive display label + severity from redline data.
 * Splits on isExecution (upstream status bucket) first, falls back to the
 * customStatusName from the workbench task, then to generic type labels.
 */
function deriveRedlineStatus(redline) {
  if (redline.isExecution)
    return { label: 'Redline Execution', severity: 'active', color: '#1d4ed8' };

  const custom = (redline.customStatusName || '').toLowerCase();
  if (custom.includes('redline review') || custom.includes('legal review'))
    return { label: 'Redline Review', severity: 'warning', color: '#ed8d00' };
  if (custom.includes('redline execution') || custom.includes('execute'))
    return { label: 'Redline Execution', severity: 'active', color: '#1d4ed8' };

  // Default for the legalReview bucket (covers the vast majority of items).
  if (redline.type === 'templateRedline')
    return { label: 'Template Redline', severity: 'warning', color: '#ed8d00' };
  if (redline.type === 'contractRedline')
    return { label: 'Contract Redline', severity: 'warning', color: '#ed8d00' };

  return { label: 'Redline Review', severity: 'warning', color: '#ed8d00' };
}
