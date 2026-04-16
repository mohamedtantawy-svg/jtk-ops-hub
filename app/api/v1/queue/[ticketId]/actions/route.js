import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';

const ZD_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN || '';
const ZD_TOKEN = process.env.ZENDESK_API_TOKEN || '';
const ZD_EMAIL = process.env.ZENDESK_EMAIL || '';

const JIRA_BASE = process.env.JIRA_BASE_URL || '';
const JIRA_EMAIL = process.env.JIRA_EMAIL || '';
const JIRA_TOKEN = process.env.JIRA_API_TOKEN || '';

function isZendeskTicket(ticketId) {
  return ticketId.startsWith('ZD-');
}

async function updateZendeskTicket(ticketId, update) {
  const url = `https://${ZD_SUBDOMAIN}.zendesk.com/api/v2/tickets/${ticketId}`;
  const auth = Buffer.from(`${ZD_EMAIL}/token:${ZD_TOKEN}`).toString('base64');
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket: update }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zendesk API ${res.status}: ${body.substring(0, 200)}`);
  }
  return res.json();
}

async function addJiraComment(issueKey, message) {
  if (!JIRA_BASE || !JIRA_TOKEN) throw new Error('Jira API not configured');
  const url = `${JIRA_BASE}/rest/api/3/issue/${issueKey}/comment`;
  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: message }] }] } }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira API ${res.status}: ${body.substring(0, 200)}`);
  }
  return res.json();
}

async function transitionJiraIssue(issueKey, status) {
  if (!JIRA_BASE || !JIRA_TOKEN) throw new Error('Jira API not configured');
  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
  // First get available transitions
  const tRes = await fetch(`${JIRA_BASE}/rest/api/3/issue/${issueKey}/transitions`, {
    headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
  });
  if (!tRes.ok) throw new Error(`Jira transitions fetch failed: ${tRes.status}`);
  const { transitions } = await tRes.json();
  const statusMap = { new: 'To Do', in_progress: 'In Progress', waiting: 'On Hold', resolved: 'Done' };
  const targetName = statusMap[status] || status;
  const match = transitions.find(t => t.name.toLowerCase() === targetName.toLowerCase());
  if (!match) return { ok: true, note: `No transition found for "${targetName}"` };
  const res = await fetch(`${JIRA_BASE}/rest/api/3/issue/${issueKey}/transitions`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ transition: { id: match.id } }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira transition failed ${res.status}: ${body.substring(0, 200)}`);
  }
  return { ok: true };
}

async function assignJiraIssue(issueKey, email) {
  if (!JIRA_BASE || !JIRA_TOKEN) throw new Error('Jira API not configured');
  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
  // Look up Jira account ID by email
  const searchRes = await fetch(`${JIRA_BASE}/rest/api/3/user/search?query=${encodeURIComponent(email)}`, {
    headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
  });
  if (!searchRes.ok) throw new Error(`Jira user search failed: ${searchRes.status}`);
  const users = await searchRes.json();
  const jiraUser = users[0];
  if (!jiraUser) throw new Error(`No Jira user found for ${email}`);
  const res = await fetch(`${JIRA_BASE}/rest/api/3/issue/${issueKey}/assignee`, {
    method: 'PUT',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: jiraUser.accountId }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira assign failed ${res.status}: ${body.substring(0, 200)}`);
  }
  return { ok: true };
}

export async function POST(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { ticketId } = await params;
  const body = await req.json();
  const { action } = body;
  const isZD = isZendeskTicket(ticketId);

  try {
    if (action === 'reply') {
      if (isZD) {
        const zdId = ticketId.replace('ZD-', '');
        await updateZendeskTicket(zdId, {
          comment: { body: body.message, public: body.public !== false },
        });
      } else {
        await addJiraComment(ticketId, body.message);
      }
      return NextResponse.json({ ok: true, action: 'reply' });
    }

    if (action === 'status') {
      if (isZD) {
        const zdId = ticketId.replace('ZD-', '');
        const statusMap = { new: 'new', in_progress: 'open', waiting: 'pending', resolved: 'solved' };
        const zdStatus = statusMap[body.status] || body.status;
        await updateZendeskTicket(zdId, { status: zdStatus });
      } else {
        await transitionJiraIssue(ticketId, body.status);
      }
      return NextResponse.json({ ok: true, action: 'status', status: body.status });
    }

    if (action === 'assignee') {
      if (isZD) {
        const zdId = ticketId.replace('ZD-', '');
        await updateZendeskTicket(zdId, { assignee_email: body.assigneeEmail });
      } else {
        await assignJiraIssue(ticketId, body.assigneeEmail);
      }
      return NextResponse.json({ ok: true, action: 'assignee' });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('[queue/actions]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
