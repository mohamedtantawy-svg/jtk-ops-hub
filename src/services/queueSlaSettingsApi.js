// ── Queue SLA settings API ─────────────────────────────────────────────────
// Reads / writes the queue-wide SLA thresholds persisted in app_settings
// (key='queue_sla_thresholds'). Returned shape:
//   { sla: { zendesk: { activeMins }, ..., onboarding: { activeMins, pausedMins } },
//     updatedBy, updatedAt, defaults }

import { apiFetch } from './api';

export async function fetchQueueSlaSettings({ signal } = {}) {
  return apiFetch('/settings/queue-sla', { signal });
}

export async function putQueueSlaSettings(sla, { signal } = {}) {
  return apiFetch('/settings/queue-sla', {
    method: 'PUT',
    body: JSON.stringify({ sla }),
    signal,
  });
}
