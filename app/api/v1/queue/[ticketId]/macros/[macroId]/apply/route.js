// ── POST /api/v1/queue/[ticketId]/macros/[macroId]/apply ─────────────────────
// Commits the macro to the ticket. Zendesk handles the actual side effects
// (field changes, comment, status, etc.) — we just send macro_ids: [macroId]
// in a PUT and ZD does the rest atomically.
//
// Auth: same scope rule as /actions and /comments.
// Jira: not supported, returns 400.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../../../src/lib/auth-helpers';
import { cacheDelMany, cacheGet } from '../../../../../../../../src/lib/server-cache';
import { getVisibleMemberEmails, isAdmin } from '../../../../../../../../src/lib/scope-helpers';
import { getVisibleCountries } from '../../../../../../../../src/lib/queue-scoping';
import { ensureRosterHydrated } from '../../../../../../../../src/lib/roster-server';
import { isZendeskConfigured } from '../../../../../../../../src/lib/zendesk-api';
import { query } from '../../../../../../../../src/lib/db';

const STALE_TTL_MS = 30 * 60_000;
const ZD_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN || '';
const ZD_TOKEN = process.env.ZENDESK_API_TOKEN || '';
const ZD_EMAIL = process.env.ZENDESK_EMAIL || '';

function isZendeskTicket(ticketId) {
  return ticketId.startsWith('ZD-');
}

async function checkTicketScope(ticketId, user) {
  if (!user) return false;
  if (isAdmin(user) || user.role === 'regional_manager') return true;
  const sourceKey = ticketId.startsWith('ZD-') ? 'queue_zendesk' : 'queue_jira';
  const combined = cacheGet('queue', STALE_TTL_MS);
  const perSource = cacheGet(sourceKey, STALE_TTL_MS);
  const pools = [];
  if (combined?.items) pools.push(combined.items);
  if (perSource?.items) pools.push(perSource.items);
  for (const pool of pools) {
    const match = pool.find(t => t.id === ticketId);
    if (!match) continue;
    const visible = getVisibleMemberEmails(user);
    const email = (match.assigneeEmail || '').toLowerCase();
    if (email && visible.has(email)) return true;
    if (!email && user.role === 'team_lead') {
      const cc = (match.country || match.countryCode || '').toUpperCase();
      if (cc && getVisibleCountries(user).has(cc)) return true;
    }
    return false;
  }
  return false;
}

async function applyMacroOnZendesk(ticketId, macroId) {
  const url = `https://${ZD_SUBDOMAIN}.zendesk.com/api/v2/tickets/${ticketId}.json`;
  const auth = Buffer.from(`${ZD_EMAIL}/token:${ZD_TOKEN}`).toString('base64');
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket: { macro_ids: [Number(macroId)] } }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zendesk API ${res.status}: ${body.substring(0, 200)}`);
  }
  return res.json();
}

export async function POST(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isZendeskConfigured()) {
    return NextResponse.json({ error: 'Zendesk API not configured' }, { status: 503 });
  }

  await ensureRosterHydrated();

  const { ticketId, macroId } = await params;
  if (!isZendeskTicket(ticketId)) {
    return NextResponse.json({ error: 'Macros are Zendesk-only', reason: 'jira_unsupported' }, { status: 400 });
  }

  if (!(await checkTicketScope(ticketId, user))) {
    return NextResponse.json({ error: 'Forbidden', reason: 'out_of_scope' }, { status: 403 });
  }

  const numericId = ticketId.replace('ZD-', '');
  try {
    await applyMacroOnZendesk(numericId, macroId);
    cacheDelMany(['queue', 'queue_zendesk']);

    // Best-effort audit log so the activity feed reflects who applied
    // which macro. The shadow row is upserted by other action routes;
    // here we just append to task_activity if it already exists.
    try {
      const { rows } = await query(
        'SELECT id FROM tasks WHERE external_id = $1 LIMIT 1',
        [ticketId],
      );
      const taskUuid = rows[0]?.id;
      if (taskUuid) {
        await query(
          'INSERT INTO task_activity (task_id, event_type, event_text, actor_name) VALUES ($1, $2, $3, $4)',
          [taskUuid, 'macro', `Applied macro #${macroId}`, user.name || user.email],
        );
      }
    } catch (logErr) {
      console.warn('[queue/macros/apply] activity log skipped:', logErr.message);
    }

    return NextResponse.json({ ok: true, ticketId, macroId: String(macroId) });
  } catch (err) {
    console.error('[queue/macros/apply]', err.message);
    return NextResponse.json({ error: err.message || 'Macro apply failed' }, { status: err.status || 500 });
  }
}
