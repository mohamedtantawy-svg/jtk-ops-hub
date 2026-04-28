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
import { getVisibleCountries } from '../../../../../../src/lib/queue-scoping';
import { canAssignTo } from '../../../../../../src/lib/task-scope-guard';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import { resolveZendeskUserIdByEmail, updateTicket as updateZdTicket, reassignTicket as reassignZdTicket } from '../../../../../../src/lib/zendesk-api';

const STALE_TTL_MS = 30 * 60_000;

// Reject writes on tickets the user wouldn't see in their own /queue view.
// Fails CLOSED on cold cache — prior behaviour defaulted to allow, which
// meant any authenticated agent could mutate any ticket ID if the server
// happened to have an empty /queue cache.
//
// Returns { allowed, reason } so callers can distinguish "this ticket is not
// visible to you" (genuine scope denial) from "we've never seen this ticket"
// (cold cache — client should refresh and retry).
async function checkTicketScope(ticketId, user) {
  if (!user) return { allowed: false, reason: 'unauthenticated' };
  if (isAdmin(user) || user.role === 'regional_manager') return { allowed: true };
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
  if (match) {
    const visible = getVisibleMemberEmails(user);
    const email = (match.assigneeEmail || '').toLowerCase();
    if (email && visible.has(email)) return { allowed: true };
    if (!email && user.role === 'team_lead') {
      // Unassigned: only allowed when the ticket's country is in the TL's scope.
      const cc = (match.country || match.countryCode || '').toUpperCase();
      if (cc && getVisibleCountries(user).has(cc)) return { allowed: true };
    }
    return { allowed: false, reason: 'out_of_scope' };
  }

  // ── Cold-cache fallback ──
  // Previously we defaulted to allow. Now we look the ticket up in the
  // persistent `tasks` table (our shadow of the source system) and apply the
  // same rule. If that also comes back empty — e.g. a fresh ticket we've
  // never synced — we fail closed with `unknown_ticket` so the client can
  // refresh its cache and retry once.
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
      if (email && visible.has(email)) return { allowed: true };
      if (!email && user.role === 'team_lead' && cc && getVisibleCountries(user).has(cc)) return { allowed: true };
      return { allowed: false, reason: 'out_of_scope' };
    }
  } catch (err) {
    console.warn('[queue/actions] cold-cache fallback lookup failed:', err.message);
  }
  return { allowed: false, reason: 'unknown_ticket' };
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

// Inline updateZendeskTicket() removed in favor of the shared lib helper
// (updateZdTicket from src/lib/zendesk-api). The lib helper supports
// X-On-Behalf-Of via opts.actAsEmail so every Zendesk write attributes
// to the authenticated team member, not the API token's owner.

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
  const statusMap = { new: 'To Do', in_progress: 'In Progress', waiting: 'On Hold', on_hold: 'On Hold', resolved: 'Done' };
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

// Cache email → Jira accountId so we don't pay a user-search round-trip on
// every single reassignment. Jira accounts almost never change and the lookup
// added ~300-500ms of latency to each assign click.
const JIRA_ACCOUNT_ID_TTL_MS = 60 * 60 * 1000;
const jiraAccountIdCache = new Map();

async function resolveJiraAccountId(email, auth) {
  const key = email.toLowerCase();
  const hit = jiraAccountIdCache.get(key);
  if (hit && Date.now() - hit.ts < JIRA_ACCOUNT_ID_TTL_MS) return hit.accountId;
  const searchRes = await fetch(`${JIRA_BASE}/rest/api/3/user/search?query=${encodeURIComponent(email)}`, {
    headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
  });
  if (!searchRes.ok) throw new Error(`Jira user search failed: ${searchRes.status}`);
  const users = await searchRes.json();
  const jiraUser = users[0];
  if (!jiraUser) throw new Error(`No Jira user found for ${email}`);
  jiraAccountIdCache.set(key, { accountId: jiraUser.accountId, ts: Date.now() });
  return jiraUser.accountId;
}

async function assignJiraIssue(issueKey, email) {
  if (!JIRA_BASE || !JIRA_TOKEN) throw new Error('Jira API not configured');
  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
  const accountId = await resolveJiraAccountId(email, auth);
  const res = await fetch(`${JIRA_BASE}/rest/api/3/issue/${issueKey}/assignee`, {
    method: 'PUT',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId }),
  });
  if (!res.ok) {
    const body = await res.text();
    // If the accountId we had cached has since been deactivated/removed, drop
    // it so the next attempt forces a fresh lookup.
    if (res.status === 400 || res.status === 404) jiraAccountIdCache.delete(email.toLowerCase());
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

  // Hydrate before any scope / canAssignTo check so a just-added TL can
  // reassign to a just-onboarded agent without a server restart.
  await ensureRosterHydrated();

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
    // Also validate the target assignee is within scope — prevents parking
    // tickets on someone in another region.
    if (body.assigneeEmail && !canAssignTo(user, body.assigneeEmail)) {
      return NextResponse.json(
        { error: 'Assignee is outside your scope or not a valid member', reason: 'assignee_scope' },
        { status: 403 },
      );
    }
  }
  const scope = await checkTicketScope(ticketId, user);
  if (!scope.allowed) {
    return NextResponse.json({ error: 'Forbidden', reason: scope.reason }, { status: 403 });
  }

  try {
    if (action === 'reply') {
      if (!body.message) return NextResponse.json({ error: 'message required for reply action' }, { status: 400 });
      if (isZD) {
        const zdId = ticketId.replace('ZD-', '');
        const comment = { body: body.message, public: body.public !== false };
        // Belt-and-suspenders attribution:
        //   1. comment.author_id  → admin-token + ZD user lookup; works on
        //                            every plan, attributes the comment.
        //   2. X-On-Behalf-Of via actAsEmail → impersonates the entire
        //                            request, so the ticket's audit log
        //                            also shows the team member as updater.
        // If both succeed, attribution is complete. If author_id misses
        // (no ZD user for that email) we still try the impersonation; the
        // worst-case is the existing fallback to token owner with a warning.
        const authorZdId = await resolveZendeskUserIdByEmail(user.email);
        if (authorZdId) {
          comment.author_id = authorZdId;
        } else {
          console.warn(`[queue/actions/reply] no ZD user for ${user.email} — comment author may fall back to API token owner`);
        }
        await updateZdTicket(zdId, { comment }, { actAsEmail: user.email });
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
        // FE → ZD status mapping. `on_hold` is a new FE-only value introduced
        // for the Phase 1 detail page so agents can pick "On hold" (ZD `hold`)
        // distinctly from "Pending" (ZD `pending`) — both collapse to our
        // app-level 'waiting' bucket but mean different things in Zendesk.
        const statusMap = { new: 'new', in_progress: 'open', waiting: 'pending', on_hold: 'hold', resolved: 'solved' };
        const zdStatus = statusMap[body.status] || body.status;
        await updateZdTicket(zdId, { status: zdStatus }, { actAsEmail: user.email });
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
        await updateZdTicket(zdId, { assignee_email: body.assigneeEmail }, { actAsEmail: user.email });
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
