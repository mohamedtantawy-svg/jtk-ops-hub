// ── GET|POST /api/v1/integrations/jira/issues ────────────────────────────────
// GET:  fetch a single issue by key (?key=HROP-123)
// POST: create a new Jira issue
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { getIssue, createIssue, addComment, isJiraConfigured } from '../../../../../../src/lib/jira-api';

const DEFAULT_PROJECT = process.env.JIRA_DEFAULT_PROJECT || 'HROP';

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
    const key = searchParams.get('key');
    if (!key) {
      return NextResponse.json({ error: 'key query param is required' }, { status: 400 });
    }

    const issue = await getIssue(key);
    return NextResponse.json(issue);
  } catch (err) {
    console.error('[integrations/jira/issues GET]', err.message);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

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
    const { action } = body;

    // Add comment to existing issue
    if (action === 'comment') {
      const { issueKey, comment } = body;
      if (!issueKey || !comment) {
        return NextResponse.json({ error: 'issueKey and comment are required' }, { status: 400 });
      }
      const result = await addComment(issueKey, comment);
      return NextResponse.json(result);
    }

    // Create new issue (default action)
    const { summary, description, issueType, projectKey } = body;
    if (!summary) {
      return NextResponse.json({ error: 'summary is required' }, { status: 400 });
    }

    const result = await createIssue(
      projectKey || DEFAULT_PROJECT,
      summary,
      description || '',
      issueType || 'Task',
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error('[integrations/jira/issues POST]', err.message);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
