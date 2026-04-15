// ── GET /api/v1/integrations/deel/onboarding ────────────────────────────────
// Proxies to Deel Admin API: list people in onboarding statuses
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listOnboardingPeople, isDeelConfigured } from '../../../../../../src/lib/deel-api';

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
    const limit = searchParams.get('limit') || '200';
    const offset = searchParams.get('offset') || '0';

    const result = await listOnboardingPeople({ limit, offset });

    // Transform to a simpler shape for the frontend
    const people = (result?.data || []).filter(p =>
      ['onboarding', 'onboarding_at_risk', 'onboarding_overdue', 'pending_invite'].includes(p.hiring_status)
    );

    const items = people.map(p => {
      const emp = p.employments?.[0] || {};
      return {
        id: p.id,
        name: p.full_name,
        email: p.email,
        country: emp.country || p.country || '',
        countryName: p.country_name || '',
        hiringStatus: p.hiring_status,
        startDate: emp.start_date || p.start_date || '',
        jobTitle: emp.job_title || '',
        hiringType: emp.hiring_type || '',
        contractId: emp.id || '',
        contractStatus: emp.contract_status || '',
        team: emp.team?.name || '',
        action: deriveAction(p.hiring_status, emp),
      };
    });

    return NextResponse.json({
      items,
      total: items.length,
      page: result?.page || {},
    });
  } catch (err) {
    console.error('[integrations/deel/onboarding]', err.message);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

function deriveAction(status, emp) {
  switch (status) {
    case 'onboarding_overdue':
      return { label: 'Overdue', severity: 'critical', description: 'Onboarding overdue - immediate action required' };
    case 'onboarding_at_risk':
      return { label: 'At Risk', severity: 'warning', description: 'Onboarding at risk - attention needed' };
    case 'pending_invite':
      return { label: 'Pending Invite', severity: 'info', description: 'Invitation not yet sent' };
    case 'onboarding':
    default:
      return { label: 'In Progress', severity: 'active', description: 'Onboarding steps in progress' };
  }
}
