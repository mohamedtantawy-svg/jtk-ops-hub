// ── Handovers API client ──────────────────────────────────────────────
// Phase 2 ships the write paths; Phase 4 will add the cron-only routes.

import { apiFetch } from './api';

/** Per-lens counts for the OOO header chip row. */
export async function fetchHandoverLensCounts() {
  return apiFetch('/handovers/lens-counts');
}

/** Default checklist template + settings preset for the current caller. */
export async function fetchDefaultChecklistTemplate() {
  return apiFetch('/handover-checklist-templates/default');
}

/** Visible-scope handover list. Filters mirror the route's query params. */
export async function listHandovers({ status, requester, manager, from, to } = {}) {
  const qs = new URLSearchParams();
  if (status)    qs.set('status', status);
  if (requester) qs.set('requester', requester);
  if (manager)   qs.set('manager', manager);
  if (from)      qs.set('from', from);
  if (to)        qs.set('to', to);
  const q = qs.toString();
  return apiFetch(`/handovers${q ? `?${q}` : ''}`);
}

/** Full handover detail (coverers + checklist + log). */
export async function getHandover(id) {
  return apiFetch(`/handovers/${encodeURIComponent(id)}`);
}

/**
 * Create a new handover draft.
 * @param {Object} payload
 * @param {string} payload.time_off_event_id        — required
 * @param {string} [payload.reason]
 * @param {Array}  [payload.coverers]               — [{ email, country_codes? }]
 * @param {Array}  [payload.checklist_items]        — overrides template
 */
export async function createHandover(payload) {
  return apiFetch('/handovers', { method: 'POST', body: JSON.stringify(payload) });
}

/** Patch a draft / pending handover. Same payload shape as create. */
export async function updateHandover(id, payload) {
  return apiFetch(`/handovers/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify(payload),
  });
}

/** Delete a draft. Submitted handovers must be cancelled instead. */
export async function deleteHandover(id) {
  return apiFetch(`/handovers/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Move draft → pending_coverage_acceptance. */
export async function submitHandover(id) {
  return apiFetch(`/handovers/${encodeURIComponent(id)}/submit`, {
    method: 'POST', body: JSON.stringify({}),
  });
}

/** Coverer accepts. */
export async function acceptHandover(id) {
  return apiFetch(`/handovers/${encodeURIComponent(id)}/accept`, {
    method: 'POST', body: JSON.stringify({}),
  });
}

/** Coverer declines (body: reason). */
export async function declineHandover(id, reason) {
  return apiFetch(`/handovers/${encodeURIComponent(id)}/decline`, {
    method: 'POST', body: JSON.stringify({ reason: reason || null }),
  });
}

/** Manager approves (body: optional note). */
export async function approveHandover(id, note) {
  return apiFetch(`/handovers/${encodeURIComponent(id)}/approve`, {
    method: 'POST', body: JSON.stringify({ note: note || null }),
  });
}

/** Manager rejects (body: reason — required). */
export async function rejectHandover(id, reason) {
  return apiFetch(`/handovers/${encodeURIComponent(id)}/reject`, {
    method: 'POST', body: JSON.stringify({ reason }),
  });
}

/** Requester / manager / admin cancels. Admin can pass `force: true`. */
export async function cancelHandover(id, reason, { force = false } = {}) {
  return apiFetch(`/handovers/${encodeURIComponent(id)}/cancel`, {
    method: 'POST', body: JSON.stringify({ reason: reason || null, force }),
  });
}

/**
 * Toggle a single checklist item.
 * @param {string} handoverId
 * @param {string} itemId    — the stable item.id (NOT the row UUID)
 * @param {Object} body      — { completed: boolean, note?: string }
 */
export async function toggleChecklistItem(handoverId, itemId, body) {
  return apiFetch(`/handovers/${encodeURIComponent(handoverId)}/checklist/${encodeURIComponent(itemId)}`, {
    method: 'PATCH', body: JSON.stringify(body),
  });
}

// Phase 4 — handback. Stub raises until lifecycle ships.
const PHASE_4_ERROR = 'Handback arrives in Phase 4 of HANDOVERS_PLAN.md';
export async function logHandback(_id, _payload) { throw new Error(PHASE_4_ERROR); }
