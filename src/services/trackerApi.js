// ── Tracker API client ────────────────────────────────────────────────────
// Thin apiFetch wrappers for the generic tracker engine (the spreadsheet
// surfaces under the "Tracker" tab). Mirrors feedbackApi.js. apiFetch returns
// the parsed body and throws on non-2xx (err.status carries the HTTP code) —
// callers treat a 403 (non-manager) as "no trackers".
import { apiFetch } from './api';

export async function listTrackers() {
  return apiFetch('/trackers');
}

export async function createTracker(payload) {
  return apiFetch('/trackers', { method: 'POST', body: JSON.stringify(payload) });
}

export async function getTracker(id) {
  return apiFetch(`/trackers/${encodeURIComponent(id)}`);
}

export async function updateTracker(id, patch) {
  return apiFetch(`/trackers/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export async function deleteTracker(id) {
  return apiFetch(`/trackers/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function listTrackerRows(id) {
  return apiFetch(`/trackers/${encodeURIComponent(id)}/rows`);
}

export async function addTrackerRow(id, payload) {
  return apiFetch(`/trackers/${encodeURIComponent(id)}/rows`, { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateTrackerRow(id, rowId, patch) {
  return apiFetch(`/trackers/${encodeURIComponent(id)}/rows/${encodeURIComponent(rowId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export async function deleteTrackerRow(id, rowId) {
  return apiFetch(`/trackers/${encodeURIComponent(id)}/rows/${encodeURIComponent(rowId)}`, { method: 'DELETE' });
}
