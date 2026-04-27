// ── Zendesk API client ───────────────────────────────────────────────────────
// Server-side only. Proxies calls to the Zendesk REST API using token auth.
// Includes automatic retry with exponential backoff on transient failures.
// Auth: {email}/token:{api_token} encoded as Basic auth.
// Docs: https://developer.zendesk.com/api-reference

import { withRetry } from './retry';

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
 * Raw fetch wrapper — no retry.
 */
async function _zendeskFetch(endpoint, options = {}) {
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
    signal: options.signal || AbortSignal.timeout(20000),
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

/**
 * Zendesk API fetch with automatic retry (3 attempts, exponential backoff).
 */
export async function zendeskFetch(endpoint, options = {}) {
  return withRetry(() => _zendeskFetch(endpoint, options), { label: 'Zendesk', maxRetries: 2 });
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

// ── Reassign Ticket ─────────────────────────────────────────────────────

export async function reassignTicket(ticketId, assigneeEmail) {
  // First look up the Zendesk user by email
  const searchRes = await zendeskFetch(`/users/search.json?query=email:${encodeURIComponent(assigneeEmail)}`);
  const user = searchRes?.users?.[0];
  if (!user) throw new Error(`Zendesk user not found for email: ${assigneeEmail}`);

  // Update the ticket's assignee
  return zendeskFetch(`/tickets/${ticketId}.json`, {
    method: 'PUT',
    body: JSON.stringify({ ticket: { assignee_id: user.id } }),
  });
}

// ── Batch Users (resolve IDs → emails/names) ───────────────────────────

export async function showManyUsers(ids) {
  if (!ids || ids.length === 0) return { users: [] };
  // Zendesk allows up to 100 IDs per call
  const batch = ids.slice(0, 100);
  return zendeskFetch(`/users/show_many.json?ids=${batch.join(',')}`);
}

// ── Ticket Fields (custom field metadata) ──────────────────────────────
// Returns the full list of ticket fields (system + custom). Each entry has:
//   { id, title, type, custom_field_options?: [{ name, value, default }] }
// Used to discover the IDs of named custom fields ("Form", "Root Cause - Support",
// "Employee Country", "Root Cause Selector") so the FE can render select boxes
// and the backend can target the right field by ID on PUT.

export async function getTicketFields() {
  return zendeskFetch('/ticket_fields.json');
}

// ── Macros ─────────────────────────────────────────────────────────────
// Macros are pre-canned bundles of ticket changes (set field, add comment,
// change status, etc.) that agents apply with one click. Phase 3 ships
// preview-then-apply: list macros, fetch a per-ticket preview, then commit
// via PUT /tickets/{id}.json with `macro_ids: [...]`.

// Active macros, paginated. ZD returns up to 100 per page; with usage_24h
// we can sort by recent popularity client-side.
export async function listMacros({ page, per_page = 100, include } = {}) {
  const qs = new URLSearchParams({ active: 'true', per_page: String(per_page) });
  if (page) qs.set('page', String(page));
  if (include) qs.set('include', include);
  return zendeskFetch(`/macros.json?${qs.toString()}`);
}

// Preview the changes a macro would make to a SPECIFIC ticket. Returns the
// would-be ticket — the macro is NOT committed. Apply via PUT /tickets/{id}
// with macro_ids: [macroId].
export async function previewMacroOnTicket(ticketId, macroId) {
  return zendeskFetch(`/tickets/${ticketId}/macros/${macroId}/apply.json`);
}

// ── Side Conversations ─────────────────────────────────────────────────
// Side conversations are off-ticket threads (email / Slack / child ticket)
// agents use to coordinate with internal teams or external parties without
// looping the original requester. Phase 4 supports email side conversations:
// list / create / read events / reply / close.

export async function listSideConversations(ticketId, { page, per_page = 100 } = {}) {
  const qs = new URLSearchParams({ per_page: String(per_page) });
  if (page) qs.set('page', String(page));
  return zendeskFetch(`/tickets/${ticketId}/side_conversations.json?${qs.toString()}`);
}

export async function getSideConversation(ticketId, sideConvId) {
  return zendeskFetch(`/tickets/${ticketId}/side_conversations/${sideConvId}.json`);
}

export async function getSideConversationEvents(ticketId, sideConvId, { page, per_page = 100 } = {}) {
  const qs = new URLSearchParams({ per_page: String(per_page) });
  if (page) qs.set('page', String(page));
  return zendeskFetch(`/tickets/${ticketId}/side_conversations/${sideConvId}/events.json?${qs.toString()}`);
}

// Create a new side conversation on a ticket. Body shape (Zendesk-native):
//   { message: { subject, body, to: [{email}, ...] } }
// We send the simplest viable payload — agents can elaborate via Zendesk's
// own UI if they need attachments / cc / bcc / templates.
export async function createSideConversation(ticketId, { subject, body, to }) {
  return zendeskFetch(`/tickets/${ticketId}/side_conversations.json`, {
    method: 'POST',
    body: JSON.stringify({
      message: {
        subject: subject || '',
        body: body || '',
        to: Array.isArray(to) ? to.map(addr => ({ email: addr })) : [],
      },
    }),
  });
}

export async function replyToSideConversation(ticketId, sideConvId, { body }) {
  return zendeskFetch(`/tickets/${ticketId}/side_conversations/${sideConvId}/reply.json`, {
    method: 'POST',
    body: JSON.stringify({ message: { body: body || '' } }),
  });
}

// Close a side conversation. ZD also supports state=open for re-opening,
// but for Phase 4 we expose only close (re-open is a low-frequency action
// that can be done from Zendesk directly).
export async function closeSideConversation(ticketId, sideConvId) {
  return zendeskFetch(`/tickets/${ticketId}/side_conversations/${sideConvId}.json`, {
    method: 'PUT',
    body: JSON.stringify({ side_conversation: { state: 'closed' } }),
  });
}
