// ── GET /api/v1/integrations/deel/offboarding ───────────────────────────────
// Returns active EOR termination cases from the Deel Admin API.
// Uses /admin/eor/terminations_v3 — the same endpoint as admin.deel.network.
// Uses persistent file cache (survives restarts) + stale-while-revalidate.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listOffboardingCases, isDeelConfigured } from '../../../../../../src/lib/deel-api';
import { cacheGet, cacheSet } from '../../../../../../src/lib/server-cache';

const CACHE_KEY = 'deel_offboarding';
const CACHE_TTL = 5 * 60 * 1000;    // fresh for 5 minutes
const STALE_TTL = 60 * 60 * 1000;   // serve stale up to 60 minutes

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

    if (!bustCache) {
      const fresh = cacheGet(CACHE_KEY, CACHE_TTL);
      if (fresh) return NextResponse.json(fresh);
    }

    let result;
    try {
      result = await buildOffboardingResult();
      cacheSet(CACHE_KEY, result);
    } catch (fetchErr) {
      const stale = cacheGet(CACHE_KEY, STALE_TTL);
      if (stale) {
        console.warn('[offboarding] Fetch failed, returning stale cache:', fetchErr.message);
        return NextResponse.json({ ...stale, _stale: true });
      }
      throw fetchErr;
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[integrations/deel/offboarding]', err.message);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

async function buildOffboardingResult() {
  const raw = await listOffboardingCases();
  const now = new Date();

  const items = raw.map(c => {
    // Use endDate (last working day) or desiredEndDate as fallback
    const endDateStr = c.endDate || c.desiredEndDate || '';
    const endDate = endDateStr ? new Date(endDateStr) : null;
    const daysUntilEnd = endDate ? Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)) : null;

    return {
      id: c.id,                                           // termination ID
      contractId: c.contractId,
      contractOid: c.contractOid || '',
      name: c.name || '',
      email: c.email || '',
      country: c.country || '',
      jobTitle: c.jobTitle || '',
      team: c.team || '',
      hiringType: c.hiringType || 'eor',
      endDate: endDateStr,
      desiredEndDate: c.desiredEndDate || '',
      startDate: c.startDate || '',
      requestedDate: c.createdAt || '',
      updatedAt: c.updatedAt || '',
      daysUntilEnd,
      noticePeriod: c.noticePeriod || 0,
      organizationName: c.organizationName || '',
      exAssignee: c.exAssignee || '',
      exAssigneeEmail: c.exAssigneeEmail || '',       // agent email (if API provides it)
      reason: c.reason || '',
      isResignation: c.isResignation || false,
      jiraUrl: c.jiraUrl || '',
      adminStatus: c.status || '',                        // raw admin status
      status: deriveStatus(c.status, daysUntilEnd),
      contractUrl: c.contractOid
        ? `https://app.deel.com/contracts/${c.contractOid}`
        : '',
    };
  });

  // Sort: AWAITING_TRIAGE first, then by days until end
  items.sort((a, b) => {
    const aUrgent = a.adminStatus === 'AWAITING_TRIAGE' ? 0 : 1;
    const bUrgent = b.adminStatus === 'AWAITING_TRIAGE' ? 0 : 1;
    if (aUrgent !== bUrgent) return aUrgent - bUrgent;
    return (a.daysUntilEnd ?? 9999) - (b.daysUntilEnd ?? 9999);
  });

  return { items, total: items.length };
}

/**
 * Derive display status from the admin API status string + days until end.
 * Admin statuses: AWAITING_TRIAGE, PROCESSING, COMPLETED, CANCELLED, etc.
 */
function deriveStatus(adminStatus, daysUntilEnd) {
  const s = (adminStatus || '').toUpperCase();

  if (s === 'COMPLETED' || s === 'DONE')
    return { label: 'Completed', severity: 'info', color: '#616161' };
  if (s === 'CANCELLED' || s === 'CANCELED')
    return { label: 'Cancelled', severity: 'info', color: '#9e9e9e' };
  if (s === 'AWAITING_TRIAGE')
    return { label: 'Awaiting Triage', severity: 'warning', color: '#ed8d00' };

  // For active cases, also factor in timeline urgency
  if (daysUntilEnd !== null && daysUntilEnd < 0)
    return { label: 'Overdue', severity: 'critical', color: '#d42d35' };
  if (daysUntilEnd !== null && daysUntilEnd <= 14)
    return { label: 'Imminent', severity: 'critical', color: '#d42d35' };

  if (s === 'PROCESSING' || s === 'IN_PROGRESS')
    return { label: 'Processing', severity: 'active', color: '#1d4ed8' };

  // Fallback: use days-based logic
  if (daysUntilEnd === null)
    return { label: adminStatus || 'Unknown', severity: 'info', color: '#9e9e9e' };
  if (daysUntilEnd <= 30)
    return { label: 'Awaiting Action', severity: 'warning', color: '#ed8d00' };
  if (daysUntilEnd <= 90)
    return { label: 'In Progress', severity: 'active', color: '#1d4ed8' };
  return { label: 'Scheduled', severity: 'info', color: '#616161' };
}
