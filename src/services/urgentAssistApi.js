// ── Urgent Assist API client ──────────────────────────────────────────────
// Thin wrappers over apiFetch for /api/v1/urgent-assist. Mirrors hrHubApi.js
// so FE call sites read consistently across surfaces.
//
// Manual rows only — workbench-sourced rows are merged into the view by
// useUrgentAssistData using useWorkbenchData + isUrgentAssistTaskType,
// so this client never touches the Deel admin proxy.

import { apiFetch } from './api';

export async function listUrgentAssist({ scope = 'mine', status, search, cursor, limit } = {}) {
  const p = new URLSearchParams();
  if (scope) p.set('scope', scope);
  if (status) p.set('status', status);
  if (search) p.set('search', search);
  if (cursor) p.set('cursor', cursor);
  if (limit) p.set('limit', String(limit));
  const qs = p.toString();
  return apiFetch(`/urgent-assist${qs ? `?${qs}` : ''}`);
}

export async function getUrgentAssist(id) {
  return apiFetch(`/urgent-assist/${encodeURIComponent(id)}`);
}

export async function createUrgentAssist(payload) {
  return apiFetch('/urgent-assist', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateUrgentAssist(id, payload) {
  return apiFetch(`/urgent-assist/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteUrgentAssist(id) {
  return apiFetch(`/urgent-assist/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
