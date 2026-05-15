// ── Time-off events API client ──────────────────────────────────────────
// Thin wrappers over /api/v1/time-off-events. The Calendar + Table modes
// inside OOOView call listTimeOffEvents; the action banner + Mine lens
// default-fetch call listMyTimeOffEvents. createTimeOffEvent /
// deleteTimeOffEvent power the manual submit + remove flow opened up
// for team members + managers in 2026-05-13.

import { apiFetch } from './api';

/**
 * Visible-scope time-off events, joined with their in-flight handover.
 * @param {Object} params
 * @param {string} [params.lens]       — 'mine' | 'covering' | 'team' | 'approvals' | 'drafts' | 'all'
 * @param {string} [params.from]       — YYYY-MM-DD inclusive lower bound on end_date
 * @param {string} [params.to]         — YYYY-MM-DD inclusive upper bound on start_date
 * @param {string} [params.workEmail]  — restrict to one person (detail panel)
 */
export async function listTimeOffEvents({ lens, from, to, workEmail } = {}) {
  const qs = new URLSearchParams();
  if (lens)      qs.set('lens', lens);
  if (from)      qs.set('from', from);
  if (to)        qs.set('to', to);
  if (workEmail) qs.set('work_email', workEmail);
  const q = qs.toString();
  return apiFetch(`/time-off-events${q ? `?${q}` : ''}`);
}

/**
 * Caller's own upcoming time-off events. Optionally clipped to events
 * ending on or after `from`. Used by the Mine lens + the "You have N
 * upcoming OOO" action banner.
 */
export async function listMyTimeOffEvents({ from } = {}) {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  const q = qs.toString();
  return apiFetch(`/time-off-events/me${q ? `?${q}` : ''}`);
}

/**
 * Manually create a time-off entry. Permission-gated server-side:
 * caller must be the target person OR a manager in their reporting
 * chain. Server stamps `source: 'manual'` and `status: 'approved'`.
 * On conflict (same person + same range + same source) the existing
 * row's reason + updated_at are bumped — retries are idempotent.
 */
export async function createTimeOffEvent({ workEmail, startDate, endDate, reason }) {
  return apiFetch('/time-off-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      work_email: workEmail,
      start_date: startDate,
      end_date: endDate,
      reason: reason || null,
    }),
  });
}

/**
 * Edit a time-off entry's start_date, end_date, or reason. Same
 * permission gate as create/delete (canManageTimeOffFor). work_email
 * is immutable — for "wrong person" cases the right path is delete +
 * recreate so audit history stays clean.
 */
export async function updateTimeOffEvent(id, { startDate, endDate, reason } = {}) {
  const body = {};
  if (startDate !== undefined) body.start_date = startDate;
  if (endDate !== undefined)   body.end_date   = endDate;
  if (reason !== undefined)    body.reason     = reason;
  return apiFetch(`/time-off-events/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Delete a time-off entry by id. 403 if the caller can't manage the
 * row's work_email; 409 if a non-terminal handover is attached (the
 * UI surfaces the cancel-handover-first guidance from the body).
 */
export async function deleteTimeOffEvent(id) {
  return apiFetch(`/time-off-events/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
