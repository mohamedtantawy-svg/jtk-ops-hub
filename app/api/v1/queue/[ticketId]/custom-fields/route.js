// ── PUT /api/v1/queue/[ticketId]/custom-fields ───────────────────────────────
// Updates one or more of the 4 ops-hub-tracked Zendesk custom fields:
//   employeeCountry / form / rootCauseSupport / rootCauseSelector
//
// Body shape: { employeeCountry?: string|null, form?: string|null,
//               rootCauseSupport?: string|null, rootCauseSelector?: string|null }
//
// Auth: same scope rule as /queue/[ticketId]/actions — any authenticated
// user who can SEE the ticket in their scoped queue can edit its fields.
// (Triage commonly involves correcting Root Cause / Form mid-ticket; the
// scope check is the defence-in-depth gate.)
//
// Jira tickets: not supported (these are Zendesk custom fields). Returns
// 400 with a clear error.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { cacheDelMany, cacheGet } from '../../../../../../src/lib/server-cache';
import { getVisibleMemberEmails, isAdmin } from '../../../../../../src/lib/scope-helpers';
import { getVisibleCountries } from '../../../../../../src/lib/queue-scoping';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import {
  resolveCustomFieldIds,
  buildCustomFieldsPatch,
  ZD_CUSTOM_FIELD_KEYS,
} from '../../../../../../src/lib/zendesk-fields';
import { isZendeskConfigured } from '../../../../../../src/lib/zendesk-api';

const STALE_TTL_MS = 30 * 60_000;
const ZD_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN || '';
const ZD_TOKEN = process.env.ZENDESK_API_TOKEN || '';
const ZD_EMAIL = process.env.ZENDESK_EMAIL || '';

function isZendeskTicket(ticketId) {
  return ticketId.startsWith('ZD-');
}

// Same scope check used by /actions and /comments routes — authoritative
// "can this user see this ticket". Mirrors the FE's queue-scoping rules.
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
      const cc = (match.country || match.countryCode || '').toUpperCase();
      if (cc && getVisibleCountries(user).has(cc)) return { allowed: true };
    }
    return { allowed: false, reason: 'out_of_scope' };
  }
  return { allowed: false, reason: 'unknown_ticket' };
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

export async function PUT(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isZendeskConfigured()) {
    return NextResponse.json({ error: 'Zendesk API not configured' }, { status: 503 });
  }

  await ensureRosterHydrated();

  const { ticketId } = await params;
  if (!isZendeskTicket(ticketId)) {
    return NextResponse.json({
      error: 'Custom-field updates are Zendesk-only',
      reason: 'jira_unsupported',
    }, { status: 400 });
  }

  const scope = await checkTicketScope(ticketId, user);
  if (!scope.allowed) {
    return NextResponse.json({ error: 'Forbidden', reason: scope.reason }, { status: 403 });
  }

  let body;
  try { body = await req.json(); } catch { body = null; }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Only allow our 4 known FE keys. Anything else is silently dropped.
  const cleanPatch = {};
  for (const k of ZD_CUSTOM_FIELD_KEYS) {
    if (k in body) cleanPatch[k] = body[k];
  }
  if (Object.keys(cleanPatch).length === 0) {
    return NextResponse.json({
      error: `Body must include at least one of: ${ZD_CUSTOM_FIELD_KEYS.join(', ')}`,
    }, { status: 400 });
  }

  // Discover field IDs and translate FE keys → Zendesk custom_fields[]
  const meta = await resolveCustomFieldIds();
  const cfPayload = buildCustomFieldsPatch(cleanPatch, meta);
  if (cfPayload.length === 0) {
    return NextResponse.json({
      error: 'None of the requested fields are configured in Zendesk',
      reason: 'fields_not_discovered',
    }, { status: 502 });
  }

  try {
    const zdId = ticketId.replace('ZD-', '');
    await updateZendeskTicket(zdId, { custom_fields: cfPayload });
    // Bust the queue cache so the next poll picks up the new values.
    cacheDelMany(['queue', 'queue_zendesk']);
    return NextResponse.json({
      ok: true,
      updated: cleanPatch,
      ticketId,
    });
  } catch (err) {
    console.error('[queue/custom-fields]', err.message);
    return NextResponse.json({
      error: err.message || 'Internal server error',
    }, { status: 500 });
  }
}
