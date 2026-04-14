// ── Zendesk API client ───────────────────────────────────────────────────────
// Server-side only. Proxies calls to the Zendesk REST API using token auth.
// Auth: {email}/token:{api_token} encoded as Basic auth.
// Docs: https://developer.zendesk.com/api-reference

const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN || ''; // e.g. "letsdeel"
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL || '';
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN || '';

const ZENDESK_BASE = ZENDESK_SUBDOMAIN
  ? `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`
  : '';

export function isZendeskConfigured() {
  return !!(ZENDESK_SUBDOMAIN && ZENDESK_EMAIL && ZENDESK_API_TOKEN);
}

/**
 * Generic fetch wrapper for Zendesk REST API v2.
 * Uses Basic auth with email/token format.
 */
export async function zendeskFetch(endpoint, options = {}) {
  if (!isZendeskConfigured()) {
    throw new Error('Zendesk API is not configured (ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN)');
  }

  const auth = Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`).toString('base64');
  const url = `${ZENDESK_BASE}${endpoint}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    },
    signal: options.signal || AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Zendesk API ${res.status}: ${body.substring(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  if (res.status === 204) return null;
  return res.json();
}

// ── Tickets ─────────────────────────────────────────────────────────────────

export async function listTickets(params = {}) {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.per_page) qs.set('per_page', String(params.per_page));
  if (params.sort_by) qs.set('sort_by', params.sort_by);
  if (params.sort_order) qs.set('sort_order', params.sort_order);
  const q = qs.toString();
  return zendeskFetch(`/tickets.json${q ? `?${q}` : ''}`);
}

export async function getTicket(ticketId) {
  return zendeskFetch(`/tickets/${ticketId}.json`);
}

export async function getTicketComments(ticketId, params = {}) {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.per_page) qs.set('per_page', String(params.per_page));
  const q = qs.toString();
  return zendeskFetch(`/tickets/${ticketId}/comments.json${q ? `?${q}` : ''}`);
}

// ── Search ──────────────────────────────────────────────────────────────────

export async function searchTickets(query, params = {}) {
  const qs = new URLSearchParams();
  qs.set('query', `type:ticket ${query}`);
  if (params.sort_by) qs.set('sort_by', params.sort_by);
  if (params.sort_order) qs.set('sort_order', params.sort_order);
  if (params.page) qs.set('page', String(params.page));
  if (params.per_page) qs.set('per_page', String(params.per_page));
  return zendeskFetch(`/search.json?${qs.toString()}`);
}

// ── Users ───────────────────────────────────────────────────────────────────

export async function listUsers(params = {}) {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.per_page) qs.set('per_page', String(params.per_page));
  if (params.role) qs.set('role', params.role);
  const q = qs.toString();
  return zendeskFetch(`/users.json${q ? `?${q}` : ''}`);
}

export async function getUser(userId) {
  return zendeskFetch(`/users/${userId}.json`);
}

export async function searchUsers(query) {
  return zendeskFetch(`/users/search.json?query=${encodeURIComponent(query)}`);
}

// ── Views (ticket queues) ───────────────────────────────────────────────────

export async function listViews() {
  return zendeskFetch('/views.json');
}

export async function getViewTickets(viewId, params = {}) {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.per_page) qs.set('per_page', String(params.per_page));
  const q = qs.toString();
  return zendeskFetch(`/views/${viewId}/tickets.json${q ? `?${q}` : ''}`);
}

// ── Groups (agent teams) ────────────────────────────────────────────────────

export async function listGroups() {
  return zendeskFetch('/groups.json');
}

// ── Ticket Update ───────────────────────────────────────────────────────────

export async function updateTicket(ticketId, data) {
  return zendeskFetch(`/tickets/${ticketId}.json`, {
    method: 'PUT',
    body: JSON.stringify({ ticket: data }),
  });
}

// ── Ticket Create ───────────────────────────────────────────────────────────

export async function createTicket(data) {
  return zendeskFetch('/tickets.json', {
    method: 'POST',
    body: JSON.stringify({ ticket: data }),
  });
}
