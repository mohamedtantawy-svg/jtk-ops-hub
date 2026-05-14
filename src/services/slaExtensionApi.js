// ── SLA Extension API client ──────────────────────────────────────────────
// Thin wrappers used by the SLA Extension HR Hub review flow:
//   • approveSlaExtension(id, days)  — manager taps Approve + picks days.
//   • denySlaExtension(id, reason)   — manager taps Deny + provides reason.
// The list of currently-active extensions is fetched alongside the queue
// hooks in Phase 3 — there's no dedicated list endpoint because the
// extensions are enriched onto queue rows server-side.

import { apiFetch } from './api';

export async function approveSlaExtension(requestId, approvedDays) {
  return apiFetch(`/sla-extension/${encodeURIComponent(requestId)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ approvedDays }),
  });
}

export async function denySlaExtension(requestId, reason) {
  return apiFetch(`/sla-extension/${encodeURIComponent(requestId)}/deny`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}
