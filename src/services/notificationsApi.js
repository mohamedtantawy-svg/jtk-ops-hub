// ── Notifications API client ──────────────────────────────────────────────
// Thin wrappers over /api/v1/notifications. The server is the source of
// truth for unread state — these helpers exist so views/hooks can stay
// thin.
// ──────────────────────────────────────────────────────────────────────────

import { apiFetch } from './api';

export async function listNotifications({ limit = 50 } = {}) {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return apiFetch(`/notifications${qs ? `?${qs}` : ''}`);
}

export async function markNotificationRead(id) {
  return apiFetch(`/notifications/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function markAllNotificationsRead() {
  return apiFetch('/notifications/read-all', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
