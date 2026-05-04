// ── Hide Task API client ──────────────────────────────────────────────────
// Thin wrappers used by the FE Hide flow:
//   • listHiddenTasks() — currently active hide list (read by every queue
//     mount via useHiddenTasks). 30s server cache + cross-tab broadcast
//     keep this cheap.
//   • approveHideTask(id) — manager taps Approve in HR Hub.
//   • denyHideTask(id, reason) — manager taps Deny + provides a reason.
//   • unhideTask(hiddenTaskId) — admin-only audit action from the Hidden
//     tab; flips unhidden_at on the hidden_task row.

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

export async function unhideTask(hiddenTaskId) {
  return apiFetch(`/hide-task/${encodeURIComponent(hiddenTaskId)}/unhide`, { method: 'POST' });
}
