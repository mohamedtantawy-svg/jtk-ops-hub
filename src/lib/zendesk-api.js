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
 *
 * `options.actAsEmail` adds the `X-On-Behalf-Of` header so Zendesk attributes
 * the call to that user instead of the API token's owner. Affects everything
 * Zendesk records about the request: comment author, ticket updater, audit
 * log entries, side-conversation message author, etc. The API token's owner
 * must be a Zendesk admin AND the impersonated user must be an active ZD
 * user. Reads (GET) don't need impersonation; pass it only on mutations.
 */
async function _zendeskFetch(endpoint, options = {}) {
  // Phase 13b (2026-05-20): callers can override the auth tuple via
  // options.tokenOverride / .subdomainOverride / .emailOverride to point
  // at a per-dept Zendesk instance (e.g. Global Immigration's
  // Zendesk_API_Payroll_GIX). When all three are unset, the module-level
  // ZENDESK_* env vars are used — HRX behavior is byte-identical.
  const tokenOverride = options.tokenOverride || null;
  const subdomainOverride = options.subdomainOverride || null;
  const emailOverride = options.emailOverride || null;
  const effSubdomain = subdomainOverride || ZENDESK_SUBDOMAIN;
  const effEmail = emailOverride || ZENDESK_EMAIL;
  const effToken = tokenOverride || ZENDESK_API_TOKEN;

  if (!effSubdomain || !effEmail || !effToken) {
    throw new Error('Zendesk API is not configured (ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN)');
  }

  const auth = Buffer.from(`${effEmail}/token:${effToken}`).toString('base64');
  const base = `https://${effSubdomain}.zendesk.com/api/v2`;
  const url = `${base}${endpoint}`;

  const headers = {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...options.headers,
  };
  // X-On-Behalf-Of needs the impersonated address to resolve to an active
  // Zendesk user — if it doesn't (no ZD account, suspended, email mismatch
  // between ops-hub and ZD) Zendesk rejects the whole request and the agent
  // sees an opaque "Internal server error" toast on actions like Send
  // Public Reply. Validate up front; if the lookup misses, drop the header
  // and let the call attribute to the API token owner with a console
  // warning. Reads (no `actAsEmail`) skip this entirely. The lookup itself
  // caches positive hits for an hour, so the cost is paid once per agent.
  if (options.actAsEmail) {
    const id = await resolveZendeskUserIdByEmail(options.actAsEmail);
    if (id) {
      headers['X-On-Behalf-Of'] = options.actAsEmail;
    } else {
      console.warn(
        `[zendesk] X-On-Behalf-Of dropped — no active ZD user for ${options.actAsEmail}; ` +
        `request will attribute to the API token owner instead`,
      );
    }
  }

  const res = await fetch(url, {
    ...options,
    headers,
    signal: options.signal || AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Zendesk API ${res.status}: ${body.substring(0, 200)}`);
    err.status = res.status;
    if (res.status === 429) {
      // Zendesk sets Retry-After in seconds (per docs + observed behaviour).
      // Pass it through to withRetry so the backoff respects the upstream's
      // cool-down hint — generic exponential backoff would miss the limit
      // window and waste another attempt. Spec also allows an HTTP-date,
      // which we parse defensively (ms diff to now, floored at 0).
      // Clamped to 60 s at the parser as defence-in-depth — withRetry caps
      // the actual wait too, but bounding the value at the source means a
      // hostile upstream can't make us hold a multi-minute timer either way.
      const RETRY_AFTER_PARSE_MAX_MS = 60_000;
      const ra = res.headers.get('Retry-After');
      if (ra) {
        let parsedMs = null;
        const asSec = Number(ra);
        if (Number.isFinite(asSec) && asSec >= 0) {
          parsedMs = Math.round(asSec * 1000);
        } else {
          const parsed = Date.parse(ra);
          if (Number.isFinite(parsed)) {
            parsedMs = Math.max(0, parsed - Date.now());
          }
        }
        if (parsedMs !== null) {
          err.retryAfterMs = Math.min(parsedMs, RETRY_AFTER_PARSE_MAX_MS);
        }
      }
    }
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

export async function searchTickets(query, params = {}, opts = {}) {
  const qs = new URLSearchParams();
  qs.set('query', `type:ticket ${query}`);
  if (params.sort_by) qs.set('sort_by', params.sort_by);
  if (params.sort_order) qs.set('sort_order', params.sort_order);
  if (params.page) qs.set('page', String(params.page));
  if (params.per_page) qs.set('per_page', String(params.per_page));
  // Sideload extra resources (e.g. `metric_sets` for accurate SLA anchors).
  // Zendesk returns each requested type as a top-level array on the response;
  // callers join by ticket_id.
  if (params.include) qs.set('include', params.include);
  // Phase 13b: pass per-dept auth overrides through to zendeskFetch when
  // provided. HRX path (opts = {}) is byte-identical to pre-Phase-13b.
  return zendeskFetch(`/search.json?${qs.toString()}`, opts);
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

// `opts.actAsEmail` impersonates that user via X-On-Behalf-Of (see _zendeskFetch).
// Phase 13b: `opts.tokenOverride` / `opts.subdomainOverride` / `opts.emailOverride`
// route the write to a per-dept Zendesk (e.g. Global Immigration).
export async function updateTicket(ticketId, data, opts = {}) {
  return zendeskFetch(`/tickets/${ticketId}.json`, {
    method: 'PUT',
    body: JSON.stringify({ ticket: data }),
    actAsEmail: opts.actAsEmail,
    tokenOverride: opts.tokenOverride,
    subdomainOverride: opts.subdomainOverride,
    emailOverride: opts.emailOverride,
  });
}

// ── Ticket Create ───────────────────────────────────────────────────────────

export async function createTicket(data, opts = {}) {
  return zendeskFetch('/tickets.json', {
    method: 'POST',
    body: JSON.stringify({ ticket: data }),
    actAsEmail: opts.actAsEmail,
  });
}

// ── Reassign Ticket ─────────────────────────────────────────────────────

export async function reassignTicket(ticketId, assigneeEmail, opts = {}) {
  // The user lookup is a read — leave it under the API token's identity.
  // Phase 13b: the lookup must hit the SAME Zendesk instance as the write
  // (Global Immigration's users live in their own Zendesk), so the auth
  // overrides flow through here too.
  const authOpts = {
    tokenOverride: opts.tokenOverride,
    subdomainOverride: opts.subdomainOverride,
    emailOverride: opts.emailOverride,
  };
  const searchRes = await zendeskFetch(
    `/users/search.json?query=email:${encodeURIComponent(assigneeEmail)}`,
    authOpts,
  );
  const user = searchRes?.users?.[0];
  if (!user) throw new Error(`Zendesk user not found for email: ${assigneeEmail}`);

  // The actual reassignment IS impersonated when actAsEmail is set, so the
  // ticket's audit log records the team member as the updater.
  return zendeskFetch(`/tickets/${ticketId}.json`, {
    method: 'PUT',
    body: JSON.stringify({ ticket: { assignee_id: user.id } }),
    actAsEmail: opts.actAsEmail,
    ...authOpts,
  });
}

// ── Batch Users (resolve IDs → emails/names) ───────────────────────────

export async function showManyUsers(ids, opts = {}) {
  if (!ids || ids.length === 0) return { users: [] };
  // Zendesk allows up to 100 IDs per call
  const batch = ids.slice(0, 100);
  // Phase 13b: pass per-dept auth overrides through so a non-HRX dept's
  // user lookup hits THAT dept's Zendesk instance (users IDs are
  // per-instance — cross-instance lookup would silently mis-resolve).
  return zendeskFetch(`/users/show_many.json?ids=${batch.join(',')}`, opts);
}

// ── Per-ticket SLA policy_metrics fetch (background SLA sync) ─────────
// Hits Zendesk's dedicated per-ticket endpoint
// `GET /tickets/{id}/slas/policy_metrics.json` — returns ONLY the
// policy_metrics array (~600 bytes per ticket) rather than the full
// ticket payload. Real response shape (verified live 2026-05-07):
//
//   {
//     "policy_metrics": [
//       { "breach_at": "2026-05-08T14:29:34Z", "stage": "active",
//         "metric": "next_reply_time",     "hours": 21 },
//       { "breach_at": "2025-12-18T03:07:32Z", "stage": "achieved",
//         "metric": "first_reply_time",    "days": -141 },
//       { "breach_at": "2026-05-14T09:03:29Z", "stage": "active",
//         "metric": "periodic_update_time", "days": 7 },
//       ...
//     ]
//   }
//
// Why this endpoint instead of `tickets/show_many?include=slas`:
//   • Payload per ticket is ~600 bytes vs 1-5 MB for show_many. With
//     ~2k active tickets, total bytes pulled per cycle drops from ~50 MB
//     to ~1.2 MB — eliminates the OOM risk that killed PR #477 entirely.
//   • Trade-off is one HTTP call per ticket. With sequential pacing
//     (~150 ms each, comfortably under Zendesk's 700 req/min Enterprise
//     limit) ~2k tickets sync in ~5 minutes — within the 10-min cron
//     window. Concurrency is intentionally NOT used here so we don't
//     blow the rate limit on noisy days.
//   • Returns nothing extraneous — no ticket bodies, no comments, no
//     metric_sets — so V8 has nothing else to keep alive while parsing.
//
// Returns the raw `{ policy_metrics: [...] }` payload, or `null` if
// Zendesk returned a 404 (ticket not found / SLA never applied). The
// caller should treat null as "no SLA data for this ticket" and skip
// the upsert (don't blank-out an existing cache row).
export async function fetchTicketSlaPolicyMetrics(ticketId) {
  if (!ticketId) return null;
  try {
    return await zendeskFetch(`/tickets/${ticketId}/slas/policy_metrics.json`);
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

// ── Resolve email → Zendesk user ID (cached 1h) ───────────────────────
// Used by the reply path to set comment.author_id so the team member's
// name appears on the ticket, not the API token owner's. ZD honours
// author_id only when the API token belongs to an admin user; if the
// lookup misses, callers should fall back to no override (current
// behaviour) and log a warning so the missing user surfaces in ops logs.
//
// Negative results (no ZD user with that email) are NOT cached — that way
// a freshly-onboarded teammate works as soon as their ZD account exists,
// without waiting for the cache to expire or restarting the server.
const ZD_USER_ID_TTL_MS = 60 * 60 * 1000;
const _zdUserIdCache = new Map();

export async function resolveZendeskUserIdByEmail(email) {
  if (!email) return null;
  const key = String(email).toLowerCase();
  const hit = _zdUserIdCache.get(key);
  if (hit && Date.now() - hit.ts < ZD_USER_ID_TTL_MS) return hit.id;
  try {
    const res = await zendeskFetch(`/users/search.json?query=email:${encodeURIComponent(email)}`);
    // ZD returns the most-recently-active matching user first; if there are
    // duplicates we take that one. Inactive/suspended users are filtered out.
    const user = (res?.users || []).find(u => u && !u.suspended) || null;
    if (!user) return null;
    _zdUserIdCache.set(key, { id: user.id, ts: Date.now() });
    return user.id;
  } catch (err) {
    console.warn(`[zendesk-api] user lookup failed for ${email}:`, err.message);
    return null;
  }
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
export async function createSideConversation(ticketId, { subject, body, to }, opts = {}) {
  return zendeskFetch(`/tickets/${ticketId}/side_conversations.json`, {
    method: 'POST',
    body: JSON.stringify({
      message: {
        subject: subject || '',
        body: body || '',
        to: Array.isArray(to) ? to.map(addr => ({ email: addr })) : [],
      },
    }),
    actAsEmail: opts.actAsEmail,
  });
}

export async function replyToSideConversation(ticketId, sideConvId, { body }, opts = {}) {
  return zendeskFetch(`/tickets/${ticketId}/side_conversations/${sideConvId}/reply.json`, {
    method: 'POST',
    body: JSON.stringify({ message: { body: body || '' } }),
    actAsEmail: opts.actAsEmail,
  });
}

// Close a side conversation. ZD also supports state=open for re-opening,
// but for Phase 4 we expose only close (re-open is a low-frequency action
// that can be done from Zendesk directly).
export async function closeSideConversation(ticketId, sideConvId, opts = {}) {
  return zendeskFetch(`/tickets/${ticketId}/side_conversations/${sideConvId}.json`, {
    method: 'PUT',
    body: JSON.stringify({ side_conversation: { state: 'closed' } }),
    actAsEmail: opts.actAsEmail,
  });
}
