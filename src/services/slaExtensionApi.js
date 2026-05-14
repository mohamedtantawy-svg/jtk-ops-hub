// ── SLA Extension API client ──────────────────────────────────────────────
// Thin wrappers used by the SLA Extension feature:
//   • listSlaExtensions()            — all currently-active extensions,
//                                      keyed (task_source, task_id). The
//                                      queue normalizer overlays these on
//                                      each row so the override applies
//                                      uniformly across every consumer
//                                      (Queue / Briefing / Team / Analytics).
//   • approveSlaExtension(id, days)  — manager taps Approve + picks days.
//   • denySlaExtension(id, reason)   — manager taps Deny + provides reason.

import { apiFetch } from './api';

export async function listSlaExtensions() {
  return apiFetch('/sla-extension/list');
}

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
