// ── GET /api/v1/integrations/test ─────────────────────────────────────────────
// Live connectivity test — hits each configured API with a lightweight call.
// Requires auth (JWT verified by middleware).
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { isDeelConfigured, deelFetch } from '../../../../../src/lib/deel-api';
import { isJiraConfigured, listProjects } from '../../../../../src/lib/jira-api';
import { isSlackConfigured, listChannels } from '../../../../../src/lib/slack-api';
import { isZendeskConfigured, listTickets } from '../../../../../src/lib/zendesk-api';

// 2026-05-13: switched from listPeople (/rest/v2/people, 401 in prod) to
// the admin /admin_profile/me endpoint — mirrors what the dedicated
// /integrations/deel/health endpoint uses, and proves the token's admin
// scope (the one we actually rely on for queue / onboarding / etc.).
async function testDeel() {
  if (!isDeelConfigured()) return { status: 'skipped', reason: 'not configured' };
  try {
    const profile = await deelFetch('/admin/admin_profile/me');
    const adminName = profile?.full_name || profile?.data?.full_name || profile?.email || '(ok)';
    return { status: 'ok', message: `Connected — admin: ${adminName}` };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

async function testJira() {
  if (!isJiraConfigured()) return { status: 'skipped', reason: 'not configured' };
  try {
    const result = await listProjects({ maxResults: 1 });
    const count = result?.total ?? result?.values?.length ?? '?';
    return { status: 'ok', message: `Connected — ${count} projects accessible` };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

async function testSlack() {
  if (!isSlackConfigured()) return { status: 'skipped', reason: 'not configured' };
  try {
    const result = await listChannels({ limit: 1 });
    return { status: 'ok', message: `Connected — channels accessible` };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

async function testZendesk() {
  if (!isZendeskConfigured()) return { status: 'skipped', reason: 'not configured' };
  try {
    const result = await listTickets({ per_page: 1 });
    const count = result?.count ?? result?.tickets?.length ?? '?';
    return { status: 'ok', message: `Connected — ${count} tickets accessible` };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Only admins can run integration tests
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin role required' }, { status: 403 });

  const [deel, jira, slack, zendesk] = await Promise.all([
    testDeel(),
    testJira(),
    testSlack(),
    testZendesk(),
  ]);

  const allOk = [deel, jira, slack, zendesk].every(
    (r) => r.status === 'ok' || r.status === 'skipped'
  );

  return NextResponse.json({
    healthy: allOk,
    timestamp: new Date().toISOString(),
    integrations: { deel, jira, slack, zendesk },
  });
}
