import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { getVisibleMemberEmails, isAdmin } from '../../../../../../src/lib/scope-helpers';
import { cacheGet } from '../../../../../../src/lib/server-cache';

const ZD_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN || '';
const ZD_TOKEN = process.env.ZENDESK_API_TOKEN || '';
const ZD_EMAIL = process.env.ZENDESK_EMAIL || '';

const JIRA_BASE = process.env.JIRA_BASE_URL || '';
const JIRA_EMAIL = process.env.JIRA_EMAIL || '';
const JIRA_TOKEN = process.env.JIRA_API_TOKEN || '';

const STALE_TTL = 30 * 60_000;

function isZendeskTicket(ticketId) {
  return ticketId.startsWith('ZD-');
}

// ── Defence-in-depth: a ticket's comments should only be readable by users
// who would already see that ticket in their scoped /queue view.
// - admin / regional_manager: always allowed
// - team_lead: allowed if the ticket is unassigned OR assigned within hierarchy
// - agent: allowed only if the ticket is assigned to them
// - cold cache (ticket not in any cached payload): default to allow, because
//   the only alternative is an extra Zendesk/Jira round-trip on every call.
function ticketInUserScope(ticketId, user) {
  if (!user) return false;
  if (isAdmin(user) || user.role === 'regional_manager') return true;

  // Look the ticket up in the most recent cached /queue payload.
  const sourceKey = isZendeskTicket(ticketId) ? 'queue_zendesk' : 'queue_jira';
  const combined = cacheGet('queue', STALE_TTL);
  const perSource = cacheGet(sourceKey, STALE_TTL);
  const pools = [];
  if (combined?.items) pools.push(combined.items);
  if (perSource?.items) pools.push(perSource.items);

  let match = null;
  for (const pool of pools) {
    match = pool.find(t => t.id === ticketId);
    if (match) break;
  }
  if (!match) return true; // Cache cold — don't block on permission misses

  const visible = getVisibleMemberEmails(user);
  const email = (match.assigneeEmail || '').toLowerCase();
  if (email && visible.has(email)) return true;
  if (!email && user.role === 'team_lead') return true;
  return false;
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

  if (!ticketInUserScope(ticketId, user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let comments;
  if (isZendeskTicket(ticketId)) {
    const zdId = ticketId.replace('ZD-', '');
    comments = await fetchZendeskComments(zdId);
  } else {
    comments = await fetchJiraComments(ticketId);
  }

  return NextResponse.json({ comments });
}
