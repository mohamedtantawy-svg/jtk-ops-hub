// ── Capacity settings API ─────────────────────────────────────────────────
// Reads / writes the per-agent capacity thresholds persisted in app_settings
// (key='queue_capacity_thresholds'). Returned shape:
//   { capacity: { lowMax, highMin }, updatedBy, updatedAt, defaults }

import { apiFetch } from './api';

export async function fetchCapacitySettings({ signal } = {}) {
  return apiFetch('/settings/capacity', { signal });
}

export async function putCapacitySettings(capacity, { signal } = {}) {
  return apiFetch('/settings/capacity', {
    method: 'PUT',
    body: JSON.stringify({ capacity }),
    signal,
  });
}
