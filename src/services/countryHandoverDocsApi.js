// ── Country Handover Docs API client ───────────────────────────────────────
// Thin wrappers over /api/v1/country-handover-docs (Phase A backend). The
// Phase B editor (`CountryHandoverDocView.jsx`) drives all four read/write
// shapes through here. Stay framework-agnostic so the same client can be
// reused by the Phase D wizard step and the Phase E coverer reader.

import { apiFetch } from './api';

/**
 * List all country handover docs (summary + freshness per row).
 * @returns {Promise<{ items: Array, total: number }>}
 */
export function listCountryHandoverDocs() {
  return apiFetch('/country-handover-docs');
}

/**
 * Fetch the full doc for one country.
 * @param {string} countryCode — ISO-2.
 */
export function getCountryHandoverDoc(countryCode) {
  return apiFetch(`/country-handover-docs/${encodeURIComponent(countryCode)}`);
}

/**
 * Partial update (debounced autosave). Body keys outside EDITABLE_FIELDS
 * are silently ignored by the server. Returns the fresh row + the count
 * of fields actually changed.
 */
export function patchCountryHandoverDoc(countryCode, body) {
  return apiFetch(`/country-handover-docs/${encodeURIComponent(countryCode)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
}

/**
 * Flip status. Default flips draft → published; `{ unpublish: true }`
 * flips back. Returns the fresh row.
 */
export function publishCountryHandoverDoc(countryCode, { unpublish = false } = {}) {
  return apiFetch(`/country-handover-docs/${encodeURIComponent(countryCode)}/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(unpublish ? { unpublish: true } : {}),
  });
}

/**
 * Audit trail for one country doc (newest first, capped at 50).
 */
export function getCountryHandoverDocHistory(countryCode) {
  return apiFetch(`/country-handover-docs/${encodeURIComponent(countryCode)}/history`);
}
