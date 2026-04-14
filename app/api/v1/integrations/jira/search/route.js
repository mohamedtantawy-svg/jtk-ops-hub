// ── POST /api/v1/integrations/jira/search ────────────────────────────────────
// Proxies JQL search to Jira Cloud
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { searchIssues, isJiraConfigured } from '../../../../../../src/lib/jira-api';

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isJiraConfigured()) {
    return NextResponse.json({ error: 'Jira API not configured' }, { status: 503 });
  }

  try {
    const body = await req.json();
    const { jql, maxResults, startAt, fields } = body;

    if (!jql) {
      return NextResponse.json({ error: 'jql is required' }, { status: 400 });
    }

    const result = await searchIssues(jql, { maxResults, startAt, fields });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[integrations/jira/search]', err.message);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
