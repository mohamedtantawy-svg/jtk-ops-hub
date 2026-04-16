// ── GET /api/v1/integrations/jira/projects ───────────────────────────────────
// List Jira projects
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listProjects, isJiraConfigured } from '../../../../../../src/lib/jira-api';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isJiraConfigured()) {
    return NextResponse.json({ error: 'Jira API not configured' }, { status: 503 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const result = await listProjects({
      maxResults: searchParams.get('maxResults') || '50',
      startAt: searchParams.get('startAt') || '0',
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[integrations/jira/projects]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: err.status || 500 });
  }
}
