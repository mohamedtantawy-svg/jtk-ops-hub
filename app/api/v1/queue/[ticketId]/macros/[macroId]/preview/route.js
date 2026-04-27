// ── GET /api/v1/queue/[ticketId]/macros/[macroId]/preview ────────────────────
// Returns what changes the named macro would make to this specific ticket
// WITHOUT actually committing them. Powers the confirmation modal in the
// Detail page so the agent can review before clicking Apply.
//
// Auth: same scope rule as /actions and /comments.
// Jira: not supported — Jira doesn't have macros, returns 400.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../../../src/lib/auth-helpers';
import { cacheGet } from '../../../../../../../../src/lib/server-cache';
import { getVisibleMemberEmails, isAdmin } from '../../../../../../../../src/lib/scope-helpers';
import { getVisibleCountries } from '../../../../../../../../src/lib/queue-scoping';
import { ensureRosterHydrated } from '../../../../../../../../src/lib/roster-server';
import { previewMacroOnTicket, isZendeskConfigured } from '../../../../../../../../src/lib/zendesk-api';
import { resolveCustomFieldIds, ZD_CUSTOM_FIELD_TITLES } from '../../../../../../../../src/lib/zendesk-fields';

const STALE_TTL_MS = 30 * 60_000;

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

// Resolve a custom-field ID → human-readable title using both our 4 named
// fields (already cached) and the broader ticket_fields response. Falls
// back to "Custom field #ID" when we don't have a friendlier label.
function buildFieldLabelLookup(fieldMeta) {
  const lookup = new Map();
  for (const [feKey, title] of Object.entries(ZD_CUSTOM_FIELD_TITLES)) {
    const m = fieldMeta?.[feKey];
    if (m?.id) lookup.set(m.id, { title, options: m.options || [] });
  }
  return lookup;
}

// Walk the ZD preview response (`result.ticket`) and pull out the changes
// the macro will make. Returns an array of { type, ...details } items the
// FE can render directly.
function summariseMacroChanges(previewTicket, fieldMeta) {
  const out = [];
  if (!previewTicket || typeof previewTicket !== 'object') return out;

  // Comment additions — public/private flag + body.
  const c = previewTicket.comment;
  if (c && (c.body || c.html_body)) {
    out.push({
      type: 'comment',
      body: (c.body || '').substring(0, 2000),
      htmlBody: (c.html_body || '').substring(0, 4000),
      public: c.public !== false,
    });
  }

  // Status / priority / type / group / assignee.
  if (previewTicket.status)     out.push({ type: 'status',     value: previewTicket.status });
  if (previewTicket.priority)   out.push({ type: 'priority',   value: previewTicket.priority });
  if (previewTicket.type)       out.push({ type: 'ticketType', value: previewTicket.type });
  if (previewTicket.assignee_id != null) out.push({ type: 'assignee', value: String(previewTicket.assignee_id) });
  if (previewTicket.group_id != null)    out.push({ type: 'group',    value: String(previewTicket.group_id) });

  // Tags additions / removals — ZD returns the FULL tag list after the macro,
  // not a diff. We pass it through so the FE can render "tags will be: [...]".
  if (Array.isArray(previewTicket.tags)) {
    out.push({ type: 'tags', value: previewTicket.tags });
  }

  // Custom field changes — `fields` is `[{id, value}, ...]`.
  if (Array.isArray(previewTicket.fields)) {
    const lookup = buildFieldLabelLookup(fieldMeta);
    for (const f of previewTicket.fields) {
      if (!f?.id) continue;
      const meta = lookup.get(f.id);
      const optionName = meta?.options?.find(o => o.value === f.value)?.name;
      out.push({
        type: 'customField',
        id: f.id,
        label: meta?.title || `Custom field #${f.id}`,
        rawValue: f.value,
        displayValue: optionName || (f.value == null ? '(cleared)' : String(f.value)),
      });
    }
  }

  // Subject changes (rare but possible).
  if (previewTicket.subject) out.push({ type: 'subject', value: previewTicket.subject });

  return out;
}

export async function GET(req, { params }) {
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
    const [preview, fieldMeta] = await Promise.all([
      previewMacroOnTicket(numericId, macroId),
      resolveCustomFieldIds(),
    ]);
    const previewTicket = preview?.result?.ticket || preview?.ticket || null;
    const changes = summariseMacroChanges(previewTicket, fieldMeta);
    return NextResponse.json({
      ticketId,
      macroId: String(macroId),
      changes,
      // `raw` exposed for debugging; FE uses `changes`.
      raw: previewTicket,
    });
  } catch (err) {
    console.error('[queue/macros/preview]', err.message);
    return NextResponse.json({ error: err.message || 'Preview failed' }, { status: err.status || 500 });
  }
}
