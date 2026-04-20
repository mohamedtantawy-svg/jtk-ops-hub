// ── GET /api/v1/integrations/deel/onboarding ────────────────────────────────
// Proxies to Deel Admin API: onboarding actionable queue.
// Uses /admin/eor/employee-manager/list/Onboarding.ActionableQueue
// Response: { statuses, result: [...tasks...], cursor }
// Uses persistent cache + stale-while-revalidate.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listOnboardingPeople, isDeelConfigured } from '../../../../../../src/lib/deel-api';
import { cacheGet, cacheSet } from '../../../../../../src/lib/server-cache';
import { scopeOnboardingPeople } from '../../../../../../src/lib/queue-scoping';

const CACHE_KEY = 'deel_onboarding';
const CACHE_TTL = 5 * 60 * 1000;    // fresh for 5 minutes
const STALE_TTL = 30 * 60 * 1000;   // serve stale up to 30 minutes

// Scope the cached payload for this user (country-based for onboarding).
// Cache stores the full payload; each request filters on the way out.
function scoped(data, user) {
  if (!data?.items) return data;
  const items = scopeOnboardingPeople(data.items, user);
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
    const offset = searchParams.get('offset') || '0';

    const cacheKeyFull = `${CACHE_KEY}_${String(offset).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const fresh = cacheGet(cacheKeyFull, CACHE_TTL);
    if (fresh) return NextResponse.json(scoped(fresh, user));

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
        return NextResponse.json({ ...scoped(stale, user), _stale: true });
      }
      throw fetchErr;
    }

    return NextResponse.json(scoped(responseData, user));
  } catch (err) {
    console.error('[integrations/deel/onboarding]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: err.status || 500 });
  }
}

/**
 * Derive action label + severity + color from the onboarding flow step.
 * Flow steps look like: "Onboarding.ComplianceDocs.AwaitingReview",
 * "Onboarding.EA.EASigning.AwaitingToSendEA",
 * "Onboarding.EA.EAAdditionalDetails.AwaitingReview", etc.
 *
 * We combine the section (ComplianceDocs, EA, etc.) with the action
 * to produce distinct, color-coded statuses.
 */
function deriveAction(flowStep) {
  const s = (flowStep || '').toLowerCase();
  const parts = (flowStep || '').split('.');

  // Identify the section (2nd segment): ComplianceDocs, EA, Benefits, etc.
  const section = parts[1] || '';
  const sectionLower = section.toLowerCase();

  // ── Critical statuses ──
  if (s.includes('rejected'))
    return { label: 'Rejected', severity: 'critical', color: '#d42d35', step: flowStep };
  if (s.includes('overdue'))
    return { label: 'Overdue', severity: 'critical', color: '#d42d35', step: flowStep };

  // ── Compliance Documents ──
  if (sectionLower === 'compliancedocs') {
    if (s.includes('awaitingreview'))
      return { label: 'Compliance Docs Review', severity: 'warning', color: '#ed8d00', step: flowStep };
    if (s.includes('awaitingupload') || s.includes('pendingupload'))
      return { label: 'Compliance Docs Upload', severity: 'warning', color: '#ed8d00', step: flowStep };
    return { label: 'Compliance Docs', severity: 'warning', color: '#ed8d00', step: flowStep };
  }

  // ── Employment Agreement ──
  if (sectionLower === 'ea') {
    if (s.includes('awaitingtosendea'))
      return { label: 'Awaiting EA Send', severity: 'active', color: '#7c3aed', step: flowStep };
    if (s.includes('additionaldetails') && s.includes('awaitingreview'))
      return { label: 'EA Details Review', severity: 'active', color: '#7c3aed', step: flowStep };
    if (s.includes('easigning'))
      return { label: 'EA Signing', severity: 'active', color: '#1d4ed8', step: flowStep };
    if (s.includes('awaitingcountersign') || s.includes('awaitingaffiliate'))
      return { label: 'EA Countersign', severity: 'active', color: '#1d4ed8', step: flowStep };
    if (s.includes('awaitingreview'))
      return { label: 'EA Review', severity: 'active', color: '#7c3aed', step: flowStep };
    return { label: 'Employment Agreement', severity: 'active', color: '#1d4ed8', step: flowStep };
  }

  // ── Benefits ──
  if (sectionLower === 'benefits') {
    if (s.includes('awaitingreview'))
      return { label: 'Benefits Review', severity: 'info', color: '#0369a1', step: flowStep };
    return { label: 'Benefits', severity: 'info', color: '#0369a1', step: flowStep };
  }

  // ── Payroll ──
  if (sectionLower === 'payroll' || sectionLower === 'payrollsetup') {
    return { label: 'Payroll Setup', severity: 'info', color: '#0369a1', step: flowStep };
  }

  // ── Generic awaiting states ──
  if (s.includes('awaitingreview'))
    return { label: 'Awaiting Review', severity: 'warning', color: '#ed8d00', step: flowStep };
  if (s.includes('awaitingtosend'))
    return { label: 'Awaiting Send', severity: 'warning', color: '#ed8d00', step: flowStep };
  if (s.includes('awaitingcountersign') || s.includes('awaitingaffiliate'))
    return { label: 'Awaiting Countersign', severity: 'active', color: '#1d4ed8', step: flowStep };

  // ── Fallback: humanize the last segment ──
  const lastPart = parts[parts.length - 1] || '';
  const friendly = lastPart.replace(/([A-Z])/g, ' $1').trim();
  return { label: friendly || 'In Progress', severity: 'active', color: '#616161', step: flowStep };
}
