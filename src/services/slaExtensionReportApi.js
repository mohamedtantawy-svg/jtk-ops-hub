// ── SLA Extension report API client ───────────────────────────────────
// Thin wrapper around /api/v1/sla-extension/report. Used by the Leaders
// Hub → Reports → SLA Extension view (LeaderReportsView /
// SlaExtensionReport).

import { apiFetch } from './api';

/**
 * Fetch the aggregated SLA Extension report.
 * @param {Object} [opts]
 * @param {string} [opts.from] — ISO date YYYY-MM-DD (inclusive)
 * @param {string} [opts.to]   — ISO date YYYY-MM-DD (inclusive)
 *
 * Both default server-side to the last 30 days when omitted.
 */
export async function fetchSlaExtensionReport({ from, to } = {}) {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to)   qs.set('to', to);
  const q = qs.toString();
  return apiFetch(`/sla-extension/report${q ? `?${q}` : ''}`);
}
