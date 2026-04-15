// ── GET /api/v1/integrations/deel/onboarding ────────────────────────────────
// Proxies to Deel Admin API: onboarding actionable queue.
// Uses /admin/eor/employee-manager/list/Onboarding.ActionableQueue
// Response: { statuses, result: [...tasks...], cursor }
// Uses persistent cache + stale-while-revalidate.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listOnboardingPeople, isDeelConfigured } from '../../../../../../src/lib/deel-api';
import { cacheGet, cacheSet } from '../../../../../../src/lib/server-cache';

const CACHE_KEY = 'deel_onboarding';
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
    const offset = searchParams.get('offset') || '0';

    const cacheKeyFull = `${CACHE_KEY}_${offset}`;
    const fresh = cacheGet(cacheKeyFull, CACHE_TTL);
    if (fresh) return NextResponse.json(fresh);

    let responseData;
    try {
      const result = await listOnboardingPeople({ offset });

      const items = result.items.map(p => ({
        ...p,
        // Derive a friendly action label from the onboardingFlowStep
        action: deriveAction(p.flowStep),
      }));

      responseData = { items, total: result.total };
      cacheSet(cacheKeyFull, responseData);
    } catch (fetchErr) {
      const stale = cacheGet(cacheKeyFull, STALE_TTL);
      if (stale) {
        console.warn('[onboarding] Fetch failed, returning stale cache:', fetchErr.message);
        return NextResponse.json({ ...stale, _stale: true });
      }
      throw fetchErr;
    }

    return NextResponse.json(responseData);
  } catch (err) {
    console.error('[integrations/deel/onboarding]', err.message);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

/**
 * Derive action label + severity from the onboarding flow step.
 * Flow steps look like: "Onboarding.ComplianceDocs.AwaitingReview",
 * "Onboarding.EA.EASigning.AwaitingToSendEA", etc.
 */
function deriveAction(flowStep) {
  const s = (flowStep || '').toLowerCase();

  // Extract the last segment as the task type
  const parts = (flowStep || '').split('.');
  const lastPart = parts[parts.length - 1] || '';
  // Convert camelCase to friendly: "AwaitingReview" → "Awaiting Review"
  const friendly = lastPart.replace(/([A-Z])/g, ' $1').trim();

  if (s.includes('awaitingreview'))
    return { label: 'Awaiting Review', severity: 'warning', step: flowStep };
  if (s.includes('awaitingtosendea'))
    return { label: 'Awaiting EA Send', severity: 'warning', step: flowStep };
  if (s.includes('awaitingcountersign') || s.includes('awaitingaffiliate'))
    return { label: 'Awaiting Countersign', severity: 'active', step: flowStep };
  if (s.includes('rejected'))
    return { label: 'Rejected', severity: 'critical', step: flowStep };
  if (s.includes('overdue'))
    return { label: 'Overdue', severity: 'critical', step: flowStep };

  return { label: friendly || 'In Progress', severity: 'active', step: flowStep };
}
