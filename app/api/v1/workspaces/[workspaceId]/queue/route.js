// ── GET /api/v1/workspaces/[workspaceId]/queue ──────────────────────────────
// Workspace-scoped queue. Mirrors HR's /api/v1/queue but:
//   • Uses the workspace's own Zendesk API token (Zendesk_API_Payroll_GIX)
//   • Filters by the workspace's Zendesk group ("Payroll" / "Immigration
//     Experience" — overridable via ZENDESK_PAYROLL_GROUP / ZENDESK_GIX_GROUP)
//   • Applies workspace-specific role scoping (admin / manager / agent) based
//     on workspace_members + the per-workspace roster
//
// Statuses matched against HR's queue:
//   new / open / pending / hold (active set) + solved updated<24h (visible
//   resolved-today bucket)
//
// Response shape mirrors HR's normalised ticket so the workspace queue UI can
// reuse the same row + filter components.

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

// SLA defaults — match HR's defaults from app/api/v1/queue/route.js so the
// pill behaviour is consistent across workspaces. Values in business-day
// minutes; for the workspace queue we apply them as wall-clock hours for
// simplicity (no business-hours engine yet — to be promoted to full HR
// parity once per-workspace SLA settings land).
const SLA_ACTIVE_HOURS = 24;
const SLA_PAUSED_HOURS = 48;

// Cache (per-process) so a refresh storm doesn't hammer Zendesk. 60s is
// short enough to feel live, long enough to absorb tab-thrash.
const CACHE_TTL_MS = 60_000;
const _cache = new Map(); // key: `${workspaceId}:${role}:${email}` → { ts, data }

function cacheKey(workspaceId, role, email) {
  return `${workspaceId}:${role}:${String(email).toLowerCase()}`;
}

function ageHoursFrom(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60);
}

function ageDaysFrom(iso) {
  const h = ageHoursFrom(iso);
  return h == null ? null : Math.floor(h / 24);
}

function computeSlaState(ticket) {
  // Paused statuses match HR's queue route behaviour — pending + hold pause
  // the SLA clock; new + open run the active clock.
  const isPaused = ticket.status === 'pending' || ticket.status === 'hold';
  const limit = isPaused ? SLA_PAUSED_HOURS : SLA_ACTIVE_HOURS;
  const age = ageHoursFrom(ticket.updated_at || ticket.created_at);
  if (age == null) return { state: 'unknown', limitHours: limit, ageHours: null };
  if (age >= limit) return { state: 'breached', limitHours: limit, ageHours: age };
  if (age >= limit * 0.75) return { state: 'at_risk', limitHours: limit, ageHours: age };
  return { state: 'within', limitHours: limit, ageHours: age };
}

function normalizeTicket(t, userMap, workspaceId) {
  const assignee = t.assignee_id ? userMap?.[t.assignee_id] : null;
  const requester = t.requester_id ? userMap?.[t.requester_id] : null;
  const sla = computeSlaState(t);
  return {
    id: `zd-${t.id}`,
    source: 'zendesk',
    workspace_id: workspaceId,
    external_id: String(t.id),
    external_url: t.url ? t.url.replace('.json', '') : null,
    subject: t.subject || '(no subject)',
    description: t.description || '',
    status: t.status,
    priority: t.priority || null,
    tags: Array.isArray(t.tags) ? t.tags : [],
    created_at: t.created_at,
    updated_at: t.updated_at,
    ageHours: sla.ageHours,
    ageDays: ageDaysFrom(t.created_at),
    sla_state: sla.state,
    sla_limit_hours: sla.limitHours,
    assignee: assignee ? { id: t.assignee_id, name: assignee.name, email: assignee.email } : null,
    requester: requester ? { id: t.requester_id, name: requester.name, email: requester.email } : null,
  };
}

// Load the workspace's roster (email → manager_email) from its allowlist
// file. Dynamic import so the route stays small for workspaces we don't
// scope here yet.
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

  // Resolve role first so we cache per role + email (admin sees more than
  // agent — caching admin's response and serving it to an agent would leak).
  let roster, scope;
  try {
    roster = await loadRoster(workspaceId);
    scope = await resolveWorkspaceUserRole(workspaceId, user.email, roster);
  } catch (err) {
    console.error(`[workspace-queue:${workspaceId}] scope resolution failed:`, err);
    return NextResponse.json({ error: 'Failed to resolve user scope' }, { status: 500 });
  }
  const { role, reports } = scope;

  // Cache lookup
  const ck = cacheKey(workspaceId, role, user.email);
  const cached = _cache.get(ck);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return NextResponse.json(cached.data);
  }

  // Fetch from Zendesk
  const group = getWorkspaceZendeskGroup(workspaceId);
  try {
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
    // Recently solved last 24h — matches HR's "still visible today" behaviour
    const solvedQ = `group:"${group}" status:solved updated<24hours`;
    const { results: solved } = await workspacePaginatedSearch(workspaceId, solvedQ, { maxPages: 5 });
    for (const ticket of solved) {
      if (!seen.has(ticket.id)) { seen.add(ticket.id); allTickets.push(ticket); }
    }

    // Batch-fetch user details for assignees + requesters
    const userIds = new Set();
    for (const t of allTickets) {
      if (t.assignee_id) userIds.add(t.assignee_id);
      if (t.requester_id) userIds.add(t.requester_id);
    }
    const userMap = await workspaceBatchFetchUsers(workspaceId, userIds);

    // Role-scope the visible tickets
    const visible = filterTicketsByRole({
      tickets: allTickets,
      userMap,
      role,
      email: user.email,
      reports,
    });

    const items = visible.map(t => normalizeTicket(t, userMap, workspaceId));
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
