// ── GET /api/v1/workspaces/[workspaceId]/queue ──────────────────────────────
// Workspace-scoped queue. Mirrors HR's /api/v1/queue normalisation so the
// shared queue UI can be byte-identical to HR Hub's table.
//
//   • Token: Zendesk_API_Payroll_GIX (per workspace, via workspace-zendesk-api)
//   • Group: "Payroll" for payroll, "Immigration Experience" for gix
//     (overridable via ZENDESK_PAYROLL_GROUP / ZENDESK_GIX_GROUP)
//   • Statuses: new / open / pending / hold (active set — solved excluded
//     per 2026-05-12 spec)
//   • Role scoping (admin / manager / agent) handled server-side via
//     workspace_members + the workspace's roster (allowlist.js ROSTER).
//
// Normalised ticket shape matches HR's queue route so the same Badges +
// table can render both. Status is mapped Zendesk→app (new→new, open→
// in_progress, pending→waiting, hold→waiting); raw Zendesk status is
// preserved in `zdStatus` for tooltip display.

import { NextResponse } from 'next/server';

import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import {
  isWorkspaceZendeskConfigured,
  workspacePaginatedSearch,
  workspaceBatchFetchUsers,
  getWorkspaceZendeskGroup,
} from '../../../../../../src/lib/workspace-zendesk-api';
import {
  resolveWorkspaceUserRole,
  filterTicketsByRole,
} from '../../../../../../src/lib/workspace-queue-scoping';

const VALID_WORKSPACES = new Set(['payroll', 'gix']);

// Status + priority maps copied from HR's queue route so the FE sees the
// same normalised shape across HR and workspace queues.
const ZD_STATUS_MAP = {
  new:     'new',
  open:    'in_progress',
  pending: 'waiting',
  hold:    'waiting',
};
const ZD_PRIORITY_MAP = {
  urgent: 'critical',
  high:   'high',
  normal: 'medium',
  low:    'low',
};

// SLA defaults — match HR's defaults from app/api/v1/queue/route.js. Values
// in business-day minutes, applied as wall-clock minutes here pending the
// per-workspace SLA settings panel.
const SLA_ACTIVE_MINS = 24 * 60;
const SLA_PAUSED_MINS = 48 * 60;

// Country / type detection — lightweight subset of HR's logic. Inferred from
// tags + subject. Full HR's COUNTRY_KEYWORDS + TYPE_KEYWORDS aren't copied
// (they're HR-territory data); we re-derive the minimum needed for column
// display. Will be expanded as patterns surface in production tickets.
const COUNTRY_TAGS = /^([a-z]{2})$/i;
const TYPE_TAG_TO_LABEL = {
  onboarding:  'Onboarding',
  offboarding: 'Offboarding',
  termination: 'Offboarding',
  benefits:    'Benefits',
  pto:         'Leave Request',
  'time-off':  'Leave Request',
  payroll:     'Payment Issue',
  payment:     'Payment Issue',
  payslip:     'Payment Issue',
  immigration: 'Immigration',
  visa:        'Immigration',
  document:    'Document Request',
};

function detectCountry(tags) {
  for (const tag of tags || []) {
    const m = String(tag).trim().match(COUNTRY_TAGS);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

function detectType(tags) {
  for (const tag of tags || []) {
    const k = String(tag).toLowerCase().trim();
    if (TYPE_TAG_TO_LABEL[k]) return TYPE_TAG_TO_LABEL[k];
  }
  return null;
}

const CACHE_TTL_MS = 60_000;
const _cache = new Map();
function cacheKey(workspaceId, role, email) {
  return `${workspaceId}:${role}:${String(email).toLowerCase()}`;
}

function minutesSince(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 60_000);
}

function normalizeTicket(t, userMap, workspaceId, subdomain) {
  const assignee = t.assignee_id ? userMap?.[t.assignee_id] : null;
  const requester = t.requester_id ? userMap?.[t.requester_id] : null;
  const appStatus = ZD_STATUS_MAP[t.status] || 'new';
  const isPaused = appStatus === 'waiting';
  const minutesAgo = minutesSince(t.created_at);
  const minutesSinceLast = minutesSince(t.updated_at || t.created_at);
  return {
    id: `ZD-${t.id}`,
    source: 'zendesk',
    workspace_id: workspaceId,
    externalId: String(t.id),
    subject: t.subject || '(no subject)',
    description: (t.description || '').substring(0, 200),
    status: appStatus,
    zdStatus: t.status || null,
    priority: ZD_PRIORITY_MAP[t.priority] || 'medium',
    type: detectType(t.tags),
    country: detectCountry(t.tags),
    assigneeEmail: assignee?.email || null,
    assigneeName: assignee?.name || null,
    requesterName: requester?.name || 'Unknown',
    requesterEmail: requester?.email || null,
    lastCustomerResponseAt: t.updated_at || t.created_at,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    pausedAt: isPaused ? (t.updated_at || t.created_at) : null,
    slaMinsOverride: isPaused ? SLA_PAUSED_MINS : SLA_ACTIVE_MINS,
    minutesAgo,
    minutesSinceLastResponse: minutesSinceLast,
    externalUrl: subdomain ? `https://${subdomain}.zendesk.com/agent/tickets/${t.id}` : '',
    tags: t.tags || [],
    // Workspace queues don't sync from Zendesk policy_metrics yet; the FE
    // slaInfo() helper falls back to the local biz-day computation against
    // slaMinsOverride when slaSource isn't 'zendesk_policy'.
    slaSource: 'local_metric_set',
    slaMetric: isPaused ? null : 'frt',
    slaBreachAt: null,
    slaFrtBreachAt: null,
    slaNrtBreachAt: null,
  };
}

async function loadRoster(workspaceId) {
  if (workspaceId === 'payroll') {
    const mod = await import('../../../../../../src/workspaces/payroll/data/allowlist');
    return mod.PAYROLL_ROSTER || {};
  }
  if (workspaceId === 'gix') {
    const mod = await import('../../../../../../src/workspaces/gix/data/allowlist');
    return mod.GIX_ROSTER || {};
  }
  return {};
}

export async function GET(req, ctx) {
  const { workspaceId } = await ctx.params;
  if (!VALID_WORKSPACES.has(workspaceId)) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }
  const user = getAuthUser(req);
  if (!user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isWorkspaceZendeskConfigured(workspaceId)) {
    return NextResponse.json({
      items: [],
      meta: {
        status: 'not_configured',
        message: `Zendesk for ${workspaceId} is not configured. Set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, and the per-workspace token env var.`,
      },
    });
  }

  let roster, scope;
  try {
    roster = await loadRoster(workspaceId);
    scope = await resolveWorkspaceUserRole(workspaceId, user.email, roster);
  } catch (err) {
    console.error(`[workspace-queue:${workspaceId}] scope resolution failed:`, err);
    return NextResponse.json({ error: 'Failed to resolve user scope' }, { status: 500 });
  }
  const { role, reports } = scope;

  const ck = cacheKey(workspaceId, role, user.email);
  const cached = _cache.get(ck);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return NextResponse.json(cached.data);
  }

  const group = getWorkspaceZendeskGroup(workspaceId);
  const subdomain = process.env.ZENDESK_SUBDOMAIN || '';
  try {
    // Active statuses only — solved excluded per 2026-05-12 spec.
    const statusQueries = ['new', 'open', 'pending', 'hold']
      .map(s => `group:"${group}" status:${s}`);
    const seen = new Set();
    const allTickets = [];
    let truncated = false;
    let serverTotal = 0;
    for (const q of statusQueries) {
      const { results, truncated: t, serverTotal: st } = await workspacePaginatedSearch(
        workspaceId, q, { maxPages: 10 },
      );
      for (const ticket of results) {
        if (!seen.has(ticket.id)) { seen.add(ticket.id); allTickets.push(ticket); }
      }
      if (t) truncated = true;
      if (typeof st === 'number') serverTotal += st;
    }

    const userIds = new Set();
    for (const t of allTickets) {
      if (t.assignee_id) userIds.add(t.assignee_id);
      if (t.requester_id) userIds.add(t.requester_id);
    }
    const userMap = await workspaceBatchFetchUsers(workspaceId, userIds);

    const visible = filterTicketsByRole({
      tickets: allTickets,
      userMap,
      role,
      email: user.email,
      reports,
    });

    const items = visible.map(t => normalizeTicket(t, userMap, workspaceId, subdomain));
    const data = {
      items,
      meta: {
        status: 'ok',
        role,
        group,
        totalFetched: allTickets.length,
        totalVisible: items.length,
        serverTotal,
        truncated,
        cachedAt: new Date().toISOString(),
      },
    };
    _cache.set(ck, { ts: Date.now(), data });
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'private, max-age=30' },
    });
  } catch (err) {
    console.error(`[workspace-queue:${workspaceId}] zendesk fetch failed:`, err);
    return NextResponse.json({
      items: [],
      meta: { status: 'error', error: err.message || 'Zendesk fetch failed' },
    }, { status: 502 });
  }
}
