// ── Hide Task API client ──────────────────────────────────────────────────
// Three thin wrappers used by the FE Hide flow:
//   • listHiddenTasks() — currently active hide list (read by every queue
//     mount via useHiddenTasks). 30s server cache + cross-tab broadcast
//     keep this cheap.
//   • approveHideTask(id) — manager taps Approve in HR Hub.
//   • denyHideTask(id, reason) — manager taps Deny + provides a reason.

import { apiFetch } from './api';

export async function listHiddenTasks() {
  return apiFetch('/hide-task/list');
}

export async function approveHideTask(requestId) {
  return apiFetch(`/hide-task/${encodeURIComponent(requestId)}/approve`, { method: 'POST' });
}

export async function denyHideTask(requestId, reason) {
  return apiFetch(`/hide-task/${encodeURIComponent(requestId)}/deny`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}
