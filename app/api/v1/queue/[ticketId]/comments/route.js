import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { getVisibleMemberEmails, isAdmin } from '../../../../../../src/lib/scope-helpers';
import { getVisibleCountries } from '../../../../../../src/lib/queue-scoping';
import { cacheGet } from '../../../../../../src/lib/server-cache';
import { query } from '../../../../../../src/lib/db';

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
// - team_lead: allowed if the ticket is unassigned in their countries OR
//   assigned within hierarchy
// - agent: allowed only if the ticket is assigned to them
// - cold cache: fall back to the persistent `tasks` table; fail CLOSED if
//   even that has no record (previously defaulted to allow, which was a hole)
async function ticketInUserScope(ticketId, user) {
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

  if (match) {
    const visible = getVisibleMemberEmails(user);
    const email = (match.assigneeEmail || '').toLowerCase();
    if (email && visible.has(email)) return true;
    if (!email && user.role === 'team_lead') {
      const cc = (match.country || match.countryCode || '').toUpperCase();
      if (cc && getVisibleCountries(user).has(cc)) return true;
    }
    return false;
  }

  // Cold-cache fallback: use the persistent shadow row.
  try {
    const { rows } = await query(
      `SELECT m.email AS assignee_email, t.country_code
         FROM tasks t
         LEFT JOIN members m ON m.id = t.assignee_id
        WHERE t.external_id = $1
        LIMIT 1`,
      [ticketId],
    );
    if (rows.length) {
      const email = (rows[0].assignee_email || '').toLowerCase();
      const cc = (rows[0].country_code || '').toUpperCase();
      const visible = getVisibleMemberEmails(user);
      if (email && visible.has(email)) return true;
      if (!email && user.role === 'team_lead' && cc && getVisibleCountries(user).has(cc)) return true;
    }
  } catch (err) {
    console.warn('[queue/comments] cold-cache fallback lookup failed:', err.message);
  }
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

  if (!(await ticketInUserScope(ticketId, user))) {
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
