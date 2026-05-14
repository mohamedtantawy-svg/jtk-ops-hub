// ── Urgent Assist Schedule API client ───────────────────────────────────
// Thin wrappers used by the HRX Urgent Assist Schedule view.
// Read is open to all signed-in users; write/delete are manager-only and
// will 403 for agents (the FE hides the Edit / Delete affordances for
// non-managers up front).
import { apiFetch } from './api';

export async function listUrgentAssistSchedule({ from = null, to = null } = {}) {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to)   qs.set('to',   to);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch(`/urgent-assist-schedule${suffix}`);
}

export async function upsertUrgentAssistScheduleDay(payload) {
  return apiFetch('/urgent-assist-schedule', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteUrgentAssistScheduleDay(id) {
  return apiFetch(`/urgent-assist-schedule/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
