// ── Time-off events API client ──────────────────────────────────────────
// Thin wrappers over /api/v1/time-off-events. The Calendar + Table modes
// inside OOOView call listTimeOffEvents; the action banner + Mine lens
// default-fetch call listMyTimeOffEvents.

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
