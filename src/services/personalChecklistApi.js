// ── Personal Checklist API client ──────────────────────────────────────────
// Thin wrappers around /api/v1/personal-checklist. The server endpoint is a
// snapshot model — GET returns the full items array and its updated_at; PUT
// replaces the snapshot atomically with a fresh updated_at. Reconciliation
// (which side is newer) lives in the calling component.

import { apiFetch } from './api';

export async function fetchChecklistSnapshot({ signal } = {}) {
  return apiFetch('/personal-checklist', { signal });
}

export async function putChecklistSnapshot(items, { signal } = {}) {
  return apiFetch('/personal-checklist', {
    method: 'PUT',
    body: JSON.stringify({ items }),
    signal,
  });
}

// 2026-05-22 — Wipe the server snapshot. Used by the PersonalChecklist
// "Clear all" affordance so users whose snapshot got contaminated by
// the pre-#747 legacy-bleed bug can recover. Server returns 204 so
// apiFetch may resolve with null/undefined — caller should treat any
// non-throw as success.
export async function clearChecklistSnapshot({ signal } = {}) {
  return apiFetch('/personal-checklist', { method: 'DELETE', signal });
}
