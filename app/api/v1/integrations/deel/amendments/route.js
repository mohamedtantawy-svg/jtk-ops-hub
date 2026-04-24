// ── GET /api/v1/integrations/deel/amendments ──────────────────────────────────
// Proxies to Deel Admin API: amendment requests (HRX actionable + paused).
// Uses /admin/eor-experience/amendments-requests
// Fetches all 5 status buckets concurrently and merges — FE splits by isPaused.
// Uses persistent cache + stale-while-revalidate.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listAmendmentRequests, isDeelConfigured } from '../../../../../../src/lib/deel-api';
import { cacheGet, cacheSet } from '../../../../../../src/lib/server-cache';
import { scopeAmendmentRequests } from '../../../../../../src/lib/queue-scoping';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';

// Default status set: Action Needed (AmendmentRequested + WaitingHrxAction)
// + all three Paused reasons (LegalReview, PausedByHRX, MobilityInput).
const DEFAULT_STATUSES = [
  'PreparingDocuments.AmendmentRequested',
  'PreparingDocuments.WaitingHrxAction',
  'PreparingDocuments.Paused.LegalReview',
  'PreparingDocuments.Paused.PausedByHRX',
  'PreparingDocuments.Paused.MobilityInput',
];

const CACHE_KEY = 'deel_amendments_v2';
const CACHE_TTL = 5 * 60 * 1000;    // fresh for 5 minutes
const STALE_TTL = 30 * 60 * 1000;   // serve stale up to 30 minutes

function scoped(data, user) {
  if (!data?.items) return data;
  const items = scopeAmendmentRequests(data.items, user);
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

  await ensureRosterHydrated();

  try {
    const { searchParams } = new URL(req.url);
    // Accept either comma-joined statuses string (legacy) or fall back to default.
    const statusesParam = searchParams.get('statuses');
    const statuses = statusesParam
      ? statusesParam.split(',').map(s => s.trim()).filter(Boolean)
      : DEFAULT_STATUSES;
    const bustCache = searchParams.get('bust') === '1';

    const cacheKeyFull = `${CACHE_KEY}_${statuses.join('|').replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    if (!bustCache) {
      const fresh = cacheGet(cacheKeyFull, CACHE_TTL);
      if (fresh) return NextResponse.json(scoped(fresh, user));
    }

    let responseData;
    try {
      const result = await listAmendmentRequests({ statuses });

      const items = result.items.map(a => ({
        ...a,
        // Derive a display label from the resolved currentStatus.
        displayStatus: deriveAmendmentStatus(a),
      }));

      responseData = { items, total: result.total };
      cacheSet(cacheKeyFull, responseData);
    } catch (fetchErr) {
      const stale = cacheGet(cacheKeyFull, STALE_TTL);
      if (stale) {
        console.warn('[amendments] Fetch failed, returning stale cache:', fetchErr.message);
        return NextResponse.json({ ...scoped(stale, user), _stale: true });
      }
      throw fetchErr;
    }

    return NextResponse.json(scoped(responseData, user));
  } catch (err) {
    console.error('[integrations/deel/amendments]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: err.status || 500 });
  }
}

/**
 * Derive display label + severity from amendment currentStatus.
 * Action-needed statuses get "warning" severity (drive SLA breach).
 * Paused sub-statuses get a distinct label each, info severity.
 */
function deriveAmendmentStatus(amendment) {
  const s = amendment.currentStatus || '';
  const type = (amendment.type || '').toUpperCase();

  // Paused sub-statuses — one label per reason.
  if (s === 'PreparingDocuments.Paused.LegalReview')
    return { label: 'Awaiting Legal Input', severity: 'info', color: '#6b3fa0' };
  if (s === 'PreparingDocuments.Paused.PausedByHRX')
    return { label: 'Paused by HRX', severity: 'info', color: '#616161' };
  if (s === 'PreparingDocuments.Paused.MobilityInput')
    return { label: 'Awaiting Mobility Input', severity: 'info', color: '#1d4ed8' };
  if (/^PreparingDocuments\.Paused/.test(s))
    return { label: 'Paused', severity: 'info', color: '#616161' };

  // Action-needed statuses.
  if (s === 'PreparingDocuments.AmendmentRequested' || /amendmentrequested$/i.test(s))
    return { label: 'Amendment Requested', severity: 'warning', color: '#ed8d00' };
  if (s === 'PreparingDocuments.WaitingHrxAction' || /waitinghrx/i.test(s))
    return { label: 'Waiting HRX Action', severity: 'warning', color: '#ed8d00' };

  // Type-based fallback (keeps existing behaviour for non-standard flows).
  if (type === 'OPS')    return { label: 'Ops Amendment',    severity: 'active',  color: '#1d4ed8' };
  if (type === 'CUSTOM') return { label: 'Custom Amendment', severity: 'active',  color: '#7c3aed' };
  if (type === 'LEGAL')  return { label: 'Legal Amendment',  severity: 'warning', color: '#ed8d00' };

  return { label: 'Amendment', severity: 'active', color: '#1d4ed8' };
}
