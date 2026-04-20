// ── POST /api/v1/queue/[ticketId]/actions ────────────────────────────────
// Pushes a replay, status change, or assignee change to the original
// ticketing system (Zendesk or Jira). Body actions: 'reply' | 'status' | 'assignee'.
//
// - Auth: every authenticated user can reply + change status on their own work.
//   Assignee changes require admin | regional_manager | team_lead.
// - Busts the persistent `/queue` cache so the next poll reflects the write
//   instead of serving stale data.
// - Upserts a shadow `tasks` row keyed by external_id and logs activity.
// ─────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getAuthUser, requireRole } from '../../../../../../src/lib/auth-helpers';
import { query } from '../../../../../../src/lib/db';
import { cacheDelMany, cacheGet } from '../../../../../../src/lib/server-cache';
import { getVisibleMemberEmails, isAdmin } from '../../../../../../src/lib/scope-helpers';

const STALE_TTL_MS = 30 * 60_000;

// Reject writes on tickets the user wouldn't see in their own /queue view.
// Mirrors ticketInUserScope from /queue/[id]/comments — keeps the behaviour
// consistent between read + write surfaces.
function ticketInUserScope(ticketId, user) {
  if (!user) return false;
  if (isAdmin(user) || user.role === 'regional_manager') return true;
  const sourceKey = ticketId.startsWith('ZD-') ? 'queue_zendesk' : 'queue_jira';
  const combined = cacheGet('queue', STALE_TTL_MS);
  const perSource = cacheGet(sourceKey, STALE_TTL_MS);
  const pools = [];
  if (combined?.items) pools.push(combined.items);
  if (perSource?.items) pools.push(perSource.items);
  let match = null;
  for (const pool of pools) {
    match = pool.find(t => t.id === ticketId);
    if (match) break;
  }
  if (!match) return true; // cold cache — degrade to allow
  const visible = getVisibleMemberEmails(user);
  const email = (match.assigneeEmail || '').toLowerCase();
  if (email && visible.has(email)) return true;
  if (!email && user.role === 'team_lead') return true;
  return false;
}

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

// ── Shadow task upsert + activity log ────────────────────────────────────────
// Keeps a persistent row keyed by the external id so we can record history for
// tickets that otherwise live only in Zendesk/Jira.
async function upsertShadowAndLog({ ticketId, source, eventType, eventText, actorName, patch = {} }) {
  try {
    const cols = ['external_id', 'source', 'subject'];
    const vals = [ticketId, source, ticketId];
    let ph = 3;
    const updates = ['updated_at = NOW()'];

    // Optional columns we may patch (status, snoozed_until, assignee_id)
    if (patch.status) {
      cols.push('status'); vals.push(patch.status); ph++;
      updates.push(`status = EXCLUDED.status`);
    }
    if (patch.snoozedUntil !== undefined) {
      cols.push('snoozed_until'); vals.push(patch.snoozedUntil); ph++;
      updates.push(`snoozed_until = EXCLUDED.snoozed_until`);
    }
    if (patch.assigneeId !== undefined) {
      cols.push('assignee_id'); vals.push(patch.assigneeId); ph++;
      updates.push(`assignee_id = EXCLUDED.assignee_id`);
    }

    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `
      INSERT INTO tasks (${cols.join(', ')})
      VALUES (${placeholders})
      ON CONFLICT (external_id) DO UPDATE
        SET ${updates.join(', ')}
      RETURNING id
    `;
    const upsert = await query(sql, vals);
    const taskUuid = upsert.rows[0]?.id;
    if (!taskUuid) return;
    await query(
      'INSERT INTO task_activity (task_id, event_type, event_text, actor_name) VALUES ($1, $2, $3, $4)',
      [taskUuid, eventType, eventText, actorName || 'System'],
    );
  } catch (err) {
    console.warn('[queue/actions] Shadow task / activity log failed:', err.message);
  }
}

export async function POST(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { ticketId } = await params;
  const body = await req.json();
  const { action } = body;
  const isZD = isZendeskTicket(ticketId);
  const source = isZD ? 'zendesk' : 'jira';

  // Assignee changes require the same role gate as /queue/reassign and
  // /tasks/[id]/assign. Reply + status changes only require the user to be
  // able to SEE the ticket (scoped view).
  if (action === 'assignee') {
    const { authorized, status, error } = requireRole(req, 'admin', 'regional_manager', 'team_lead');
    if (!authorized) return NextResponse.json({ error }, { status });
  }
  if (!ticketInUserScope(ticketId, user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    if (action === 'reply') {
      if (!body.message) return NextResponse.json({ error: 'message required for reply action' }, { status: 400 });
      if (isZD) {
        const zdId = ticketId.replace('ZD-', '');
        await updateZendeskTicket(zdId, {
          comment: { body: body.message, public: body.public !== false },
        });
      } else {
        await addJiraComment(ticketId, body.message);
      }
      await upsertShadowAndLog({
        ticketId, source, eventType: 'reply',
        eventText: `Replied (${body.public !== false ? 'public' : 'internal'})`,
        actorName: user.name,
      });
      cacheDelMany(['queue', `queue_${source}`]);
      return NextResponse.json({ ok: true, action: 'reply' });
    }

    if (action === 'status') {
      if (!body.status) return NextResponse.json({ error: 'status required for status action' }, { status: 400 });
      if (isZD) {
        const zdId = ticketId.replace('ZD-', '');
        const statusMap = { new: 'new', in_progress: 'open', waiting: 'pending', resolved: 'solved' };
        const zdStatus = statusMap[body.status] || body.status;
        await updateZendeskTicket(zdId, { status: zdStatus });
      } else {
        await transitionJiraIssue(ticketId, body.status);
      }
      await upsertShadowAndLog({
        ticketId, source, eventType: 'status',
        eventText: `Status changed to ${body.status}`,
        actorName: user.name,
        patch: { status: body.status },
      });
      cacheDelMany(['queue', `queue_${source}`]);
      return NextResponse.json({ ok: true, action: 'status', status: body.status });
    }

    if (action === 'assignee') {
      if (!body.assigneeEmail) return NextResponse.json({ error: 'assigneeEmail required for assignee action' }, { status: 400 });
      if (isZD) {
        const zdId = ticketId.replace('ZD-', '');
        await updateZendeskTicket(zdId, { assignee_email: body.assigneeEmail });
      } else {
        await assignJiraIssue(ticketId, body.assigneeEmail);
      }
      const asgn = await query(
        'SELECT id FROM members WHERE LOWER(email) = LOWER($1) LIMIT 1',
        [body.assigneeEmail],
      );
      await upsertShadowAndLog({
        ticketId, source, eventType: 'assign',
        eventText: `Reassigned to ${body.assigneeEmail}`,
        actorName: user.name,
        patch: { assigneeId: asgn.rows[0]?.id || null },
      });
      cacheDelMany(['queue', `queue_${source}`]);
      return NextResponse.json({ ok: true, action: 'assignee' });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('[queue/actions]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
