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

async function fetchZendeskComments(ticketId) {
  if (!ZD_SUBDOMAIN || !ZD_TOKEN) return [];
  const url = `https://${ZD_SUBDOMAIN}.zendesk.com/api/v2/tickets/${ticketId}/comments?sort_order=desc&per_page=5`;
  const auth = Buffer.from(`${ZD_EMAIL}/token:${ZD_TOKEN}`).toString('base64');
  const res = await fetch(url, {
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.comments || []).map(c => ({
    id: c.id,
    body: (c.body || '').substring(0, 1000),
    htmlBody: (c.html_body || '').substring(0, 2000),
    author: c.author_id,
    public: c.public,
    createdAt: c.created_at,
  }));
}

async function fetchJiraComments(issueKey) {
  if (!JIRA_BASE || !JIRA_TOKEN) return [];
  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
  const url = `${JIRA_BASE}/rest/api/3/issue/${issueKey}/comment?orderBy=-created&maxResults=5`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.comments || []).map(c => ({
    id: c.id,
    body: typeof c.body === 'string' ? c.body.substring(0, 1000) : (c.body?.content?.map(b => b.content?.map(t => t.text).join('')).join('\n') || '').substring(0, 1000),
    htmlBody: '',
    author: c.author?.displayName || c.author?.emailAddress || c.author?.accountId || '',
    public: true,
    createdAt: c.created,
  }));
}

export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { ticketId } = await params;

  let comments;
  if (isZendeskTicket(ticketId)) {
    const zdId = ticketId.replace('ZD-', '');
    comments = await fetchZendeskComments(zdId);
  } else {
    comments = await fetchJiraComments(ticketId);
  }

  return NextResponse.json({ comments });
}
