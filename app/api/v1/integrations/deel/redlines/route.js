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
import { cacheGet, cacheSet } from '../../../../../../src/lib/server-cache';
import { scopeRedlineRequests } from '../../../../../../src/lib/queue-scoping';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';

// Default: both Review (legalReview) and Execution (HRXToExecute) buckets —
// the two "Action Needed" surfaces on admin.deel.network.
const DEFAULT_STATUSES = [
  'preparingDocuments.legalReview',
  'preparingDocuments.HRXToExecute',
];

const CACHE_KEY = 'deel_redlines_v2';
const CACHE_TTL = 5 * 60 * 1000;    // fresh for 5 minutes
const STALE_TTL = 30 * 60 * 1000;   // serve stale up to 30 minutes

function scoped(data, user) {
  if (!data?.items) return data;
  const items = scopeRedlineRequests(data.items, user);
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

  // Hydrate the server roster before scopeRedlineRequests runs.
  await ensureRosterHydrated();

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
      if (fresh) return NextResponse.json(scoped(fresh, user));
    }

    let responseData;
    try {
      const result = await listRedlineRequests({ status: statuses });

      const items = result.items.map(r => ({
        ...r,
        displayStatus: deriveRedlineStatus(r),
      }));

      responseData = { items, total: result.total };
      cacheSet(cacheKeyFull, responseData);
    } catch (fetchErr) {
      const stale = cacheGet(cacheKeyFull, STALE_TTL);
      if (stale) {
        console.warn('[redlines] Fetch failed, returning stale cache:', fetchErr.message);
        return NextResponse.json({ ...scoped(stale, user), _stale: true });
      }
      throw fetchErr;
    }

    return NextResponse.json(scoped(responseData, user));
  } catch (err) {
    console.error('[integrations/deel/redlines]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: err.status || 500 });
  }
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
