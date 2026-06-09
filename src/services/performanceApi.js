// ── Performance API client ──────────────────────────────────────────────────
// Thin apiFetch wrappers for the Performance tab. Templates (Phase B); reviews,
// cycles, warnings, dashboards added in later phases. apiFetch returns the body
// and throws on non-2xx (err.status carries the HTTP code) — callers treat 403
// (non-manager) as "no access".
import { apiFetch } from './api';

// ── Templates ──
export async function listPerfTemplates() {
  return apiFetch('/performance/templates');
}
export async function createPerfTemplate(payload) {
  return apiFetch('/performance/templates', { method: 'POST', body: JSON.stringify(payload) });
}
export async function getPerfTemplate(id) {
  return apiFetch(`/performance/templates/${encodeURIComponent(id)}`);
}
export async function updatePerfTemplate(id, patch) {
  return apiFetch(`/performance/templates/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
}
export async function deletePerfTemplate(id) {
  return apiFetch(`/performance/templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── Reviews ──
// scope: 'mine' | 'team' | 'all'; month/year optional; member optional.
export async function listPerfReviews({ scope, month, year, member } = {}) {
  const p = new URLSearchParams();
  if (scope) p.set('scope', scope);
  if (month) p.set('month', String(month));
  if (year) p.set('year', String(year));
  if (member) p.set('member', member);
  const qs = p.toString();
  return apiFetch(`/performance/reviews${qs ? `?${qs}` : ''}`);
}
export async function upsertPerfReview(payload) {
  return apiFetch('/performance/reviews', { method: 'POST', body: JSON.stringify(payload) });
}
export async function getPerfReview(id) {
  return apiFetch(`/performance/reviews/${encodeURIComponent(id)}`);
}
export async function patchPerfReview(id, patch) {
  return apiFetch(`/performance/reviews/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
}
