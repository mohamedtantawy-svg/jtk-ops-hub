// ── GET /api/v1/integrations/deel/redlines ─────────────────────────────────────
// Proxies to Deel Admin API: redline requests (Preparing Document).
// Uses /admin/eor-experience/redline-requests
// Response: { redlines: [...], cursor, totalCount }
// Uses persistent cache + stale-while-revalidate.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listRedlineRequests, isDeelConfigured } from '../../../../../../src/lib/deel-api';
import { cacheGet, cacheSet } from '../../../../../../src/lib/server-cache';

const CACHE_KEY = 'deel_redlines';
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
    const status = searchParams.get('status') || 'preparingDocuments.legalReview';
    const bustCache = searchParams.get('bust') === '1';

    const cacheKeyFull = `${CACHE_KEY}_${status.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    if (!bustCache) {
      const fresh = cacheGet(cacheKeyFull, CACHE_TTL);
      if (fresh) return NextResponse.json(fresh);
    }

    let responseData;
    try {
      const result = await listRedlineRequests({ status });

      const items = result.items.map(r => ({
        ...r,
        // Derive a display status from the redline's workbench task
        displayStatus: deriveRedlineStatus(r),
      }));

      responseData = { items, total: result.total };
      cacheSet(cacheKeyFull, responseData);
    } catch (fetchErr) {
      const stale = cacheGet(cacheKeyFull, STALE_TTL);
      if (stale) {
        console.warn('[redlines] Fetch failed, returning stale cache:', fetchErr.message);
        return NextResponse.json({ ...stale, _stale: true });
      }
      throw fetchErr;
    }

    return NextResponse.json(responseData);
  } catch (err) {
    console.error('[integrations/deel/redlines]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: err.status || 500 });
  }
}

/**
 * Derive display label + severity from redline data.
 * customStatusName values: "Redline Review", "Redline Execution", etc.
 * workbenchStatus: "IN_PROGRESS", "PENDING", etc.
 */
function deriveRedlineStatus(redline) {
  const custom = (redline.customStatusName || '').toLowerCase();
  const wbStatus = (redline.workbenchStatus || '').toUpperCase();
  const type = redline.type || '';

  if (custom.includes('redline review'))
    return { label: 'Redline Review', severity: 'warning', color: '#ed8d00' };
  if (custom.includes('redline execution'))
    return { label: 'Redline Execution', severity: 'active', color: '#1d4ed8' };

  // Fallback to workbench status
  if (wbStatus === 'IN_PROGRESS')
    return { label: 'In Progress', severity: 'active', color: '#1d4ed8' };
  if (wbStatus === 'PENDING')
    return { label: 'Pending', severity: 'warning', color: '#ed8d00' };

  // Type-based fallback
  if (type === 'templateRedline')
    return { label: 'Template Redline', severity: 'active', color: '#7c3aed' };
  if (type === 'contractRedline')
    return { label: 'Contract Redline', severity: 'active', color: '#1d4ed8' };

  return { label: 'Redline', severity: 'active', color: '#1d4ed8' };
}
