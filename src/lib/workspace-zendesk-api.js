// ── Workspace-scoped Zendesk client ──────────────────────────────────────────
// Server-side only. Mirrors src/lib/zendesk-api.js but auth + group are
// determined by the active workspace id. Same Zendesk subdomain + email
// (one Zendesk account); each non-HR workspace has its own API token and
// each maps to a Zendesk Group (the team in Zendesk owns the tickets).
//
// HR's existing client (src/lib/zendesk-api.js) is untouched; it stays the
// canonical entry point for HR Hub. This file is the parallel implementation
// for Payroll / GIX / future workspaces. The two clients can co-exist —
// they don't share state and one outage doesn't affect the other.
//
// Config (env vars set in Nexus):
//   ZENDESK_SUBDOMAIN              — shared (letsdeel)
//   ZENDESK_EMAIL                  — shared (API user identity)
//   Zendesk_API_Payroll_GIX        — token for Payroll + GIX workspaces
//   ZENDESK_PAYROLL_GROUP          — optional override (default "Payroll")
//   ZENDESK_GIX_GROUP              — optional override (default "Immigration Experience")

import { withRetry } from './retry';

const SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN || '';
const EMAIL = process.env.ZENDESK_EMAIL || '';

// Workspace → { token env var name, default group, group env override }.
// Tokens are read lazily (per-request) so deploys that rotate them don't
// require a process restart.
const WORKSPACE_CONFIG = {
  payroll: {
    tokenEnv: 'Zendesk_API_Payroll_GIX',
    defaultGroup: 'Payroll',
    groupEnv: 'ZENDESK_PAYROLL_GROUP',
  },
  gix: {
    tokenEnv: 'Zendesk_API_Payroll_GIX',
    defaultGroup: 'Immigration Experience',
    groupEnv: 'ZENDESK_GIX_GROUP',
  },
};

// 2026-05-22 (evening): the `Zendesk_API_Payroll_GIX` env var is
// mixed-case. Some Nexus / K8s configmap deployments normalize env
// var names to uppercase at storage time, which would make the
// literal lookup miss. Try the literal name first, then ALL_CAPS,
// then lowercase before giving up. Matches the resilient lookup in
// dept-integrations.js so both Zendesk codepaths (workspace + dept)
// see the same env var under any casing.
function readEnvResilient(name) {
  if (!name) return '';
  const tried = [name, name.toUpperCase(), name.toLowerCase()];
  for (const v of tried) {
    const value = process.env[v];
    if (value) return value;
  }
  return '';
}

function readToken(workspaceId) {
  const cfg = WORKSPACE_CONFIG[workspaceId];
  if (!cfg) return '';
  return readEnvResilient(cfg.tokenEnv);
}

export function getWorkspaceZendeskGroup(workspaceId) {
  const cfg = WORKSPACE_CONFIG[workspaceId];
  if (!cfg) return '';
  return readEnvResilient(cfg.groupEnv) || cfg.defaultGroup;
}

export function isWorkspaceZendeskConfigured(workspaceId) {
  return !!(SUBDOMAIN && EMAIL && readToken(workspaceId));
}

function buildAuth(workspaceId) {
  const token = readToken(workspaceId);
  return Buffer.from(`${EMAIL}/token:${token}`).toString('base64');
}

async function _fetchOnce(workspaceId, endpoint, options = {}) {
  if (!isWorkspaceZendeskConfigured(workspaceId)) {
    throw new Error(
      `Workspace Zendesk not configured for "${workspaceId}" — ` +
      `check ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, and ${WORKSPACE_CONFIG[workspaceId]?.tokenEnv || '<token env>'}`,
    );
  }
  const url = `https://${SUBDOMAIN}.zendesk.com/api/v2${endpoint}`;
  const headers = {
    Authorization: `Basic ${buildAuth(workspaceId)}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...options.headers,
  };
  const res = await fetch(url, {
    ...options,
    headers,
    signal: options.signal || AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Zendesk(${workspaceId}) ${res.status}: ${body.substring(0, 200)}`);
    err.status = res.status;
    if (res.status === 429) {
      const ra = res.headers.get('Retry-After');
      if (ra) {
        const asSec = Number(ra);
        if (Number.isFinite(asSec) && asSec >= 0) {
          err.retryAfterMs = Math.min(asSec * 1000, 60_000);
        }
      }
    }
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function workspaceZendeskFetch(workspaceId, endpoint, options = {}) {
  return withRetry(
    () => _fetchOnce(workspaceId, endpoint, options),
    { label: `Zendesk[${workspaceId}]`, maxRetries: 2 },
  );
}

// ── Search ──────────────────────────────────────────────────────────────────

export async function workspaceSearchTickets(workspaceId, query, params = {}) {
  const qs = new URLSearchParams();
  qs.set('query', query);
  if (params.page) qs.set('page', String(params.page));
  if (params.per_page) qs.set('per_page', String(params.per_page));
  if (params.sort_by) qs.set('sort_by', params.sort_by);
  if (params.sort_order) qs.set('sort_order', params.sort_order);
  return workspaceZendeskFetch(workspaceId, `/search.json?${qs.toString()}`);
}

// Paginated wrapper. Caps at `maxPages` to bound memory + respect Zendesk's
// 1,000-hit search limit. Returns `truncated` flag so the UI can warn when
// data was cut off.
export async function workspacePaginatedSearch(workspaceId, query, { maxPages = 10, perPage = 100 } = {}) {
  const allResults = [];
  let page = 1;
  let truncated = false;
  let serverTotal = null;
  while (page <= maxPages) {
    const res = await workspaceSearchTickets(workspaceId, query, {
      per_page: perPage,
      page,
      sort_by: 'updated_at',
      sort_order: 'desc',
    });
    const results = res?.results || [];
    if (typeof res?.count === 'number') serverTotal = res.count;
    allResults.push(...results);
    if (results.length < perPage || !res?.next_page) break;
    page++;
    if (page > maxPages && res?.next_page) truncated = true;
  }
  return { results: allResults, truncated, serverTotal };
}

// ── Users (for assignee / requester lookups) ─────────────────────────────────

export async function workspaceShowManyUsers(workspaceId, userIds) {
  if (!userIds || !userIds.length) return { users: [] };
  const idsStr = userIds.join(',');
  return workspaceZendeskFetch(workspaceId, `/users/show_many.json?ids=${idsStr}`);
}

// Batch user fetch (handles >100 by chunking).
export async function workspaceBatchFetchUsers(workspaceId, userIds) {
  const userMap = {};
  const idArray = [...userIds];
  for (let i = 0; i < idArray.length; i += 100) {
    const batch = idArray.slice(i, i + 100);
    try {
      const res = await workspaceShowManyUsers(workspaceId, batch);
      for (const u of (res?.users || [])) {
        userMap[u.id] = { name: u.name, email: u.email };
      }
    } catch (err) {
      console.warn(`[workspace-zendesk:${workspaceId}] user batch ${i}-${i + batch.length} failed:`, err.message);
    }
  }
  return userMap;
}
