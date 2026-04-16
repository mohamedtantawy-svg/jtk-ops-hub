// ── GET /api/v1/integrations/deel/amendments ──────────────────────────────────
// Proxies to Deel Admin API: amendment requests (HRX actionable).
// Uses /admin/eor-experience/amendments-requests
// Response: { filter, cursor, data: [...] }
// Uses persistent cache + stale-while-revalidate.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listAmendmentRequests, isDeelConfigured } from '../../../../../../src/lib/deel-api';
import { cacheGet, cacheSet } from '../../../../../../src/lib/server-cache';

const CACHE_KEY = 'deel_amendments';
const CACHE_TTL = 5 * 60 * 1000;    // fresh for 5 minutes
const STALE_TTL = 30 * 60 * 1000;   // serve stale up to 30 minutes

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
    const statuses = searchParams.get('statuses') || 'PreparingDocuments.AmendmentRequested';
    const bustCache = searchParams.get('bust') === '1';

    const cacheKeyFull = `${CACHE_KEY}_${statuses.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    if (!bustCache) {
      const fresh = cacheGet(cacheKeyFull, CACHE_TTL);
      if (fresh) return NextResponse.json(fresh);
    }

    let responseData;
    try {
      const result = await listAmendmentRequests({ statuses });

      const items = result.items.map(a => ({
        ...a,
        // Derive a display status from the amendment type + statuses
        displayStatus: deriveAmendmentStatus(a),
      }));

      responseData = { items, total: result.total };
      cacheSet(cacheKeyFull, responseData);
    } catch (fetchErr) {
      const stale = cacheGet(cacheKeyFull, STALE_TTL);
      if (stale) {
        console.warn('[amendments] Fetch failed, returning stale cache:', fetchErr.message);
        return NextResponse.json({ ...stale, _stale: true });
      }
      throw fetchErr;
    }

    return NextResponse.json(responseData);
  } catch (err) {
    console.error('[integrations/deel/amendments]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: err.status || 500 });
  }
}

/**
 * Derive display label + severity from amendment data.
 * Key statuses: AmendmentRequested, WaitingHRXAction, PendingSOWCountersign,
 * PendingEACountersign, Paused
 */
function deriveAmendmentStatus(amendment) {
  const currentStatus = (amendment.currentStatus || '').toLowerCase();
  const type = (amendment.type || '').toUpperCase();

  if (currentStatus.includes('amendmentrequested') || currentStatus.includes('amendment_requested'))
    return { label: 'Amendment Requested', severity: 'warning', color: '#ed8d00' };
  if (currentStatus.includes('waitinghrx') || currentStatus.includes('waiting_hrx'))
    return { label: 'Waiting HRX Action', severity: 'warning', color: '#ed8d00' };
  if (currentStatus.includes('pendingsowcountersign') || currentStatus.includes('pending_sow'))
    return { label: 'Pending SOW Countersign', severity: 'active', color: '#1d4ed8' };
  if (currentStatus.includes('pendingeacountersign') || currentStatus.includes('pending_ea'))
    return { label: 'Pending EA Countersign', severity: 'active', color: '#1d4ed8' };
  if (currentStatus.includes('paused'))
    return { label: 'Paused', severity: 'info', color: '#616161' };

  // Type-based fallback
  if (type === 'OPS')
    return { label: 'Ops Amendment', severity: 'active', color: '#1d4ed8' };
  if (type === 'CUSTOM')
    return { label: 'Custom Amendment', severity: 'active', color: '#7c3aed' };
  if (type === 'LEGAL')
    return { label: 'Legal Amendment', severity: 'warning', color: '#ed8d00' };

  return { label: 'Amendment', severity: 'active', color: '#1d4ed8' };
}
