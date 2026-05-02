// ── Leaders Alerts API client ────────────────────────────────────────────
// Thin wrappers over apiFetch — same shape as the other service modules.
// See LEADER_ALERTS_PLAN.md for the route-by-route contract these cover.

import { apiFetch } from './api';

// ── Alerts ────────────────────────────────────────────────────────────────

export async function listLeaderAlerts({ scope = 'all', status, severity, category, impact, search, cursor, limit, signal } = {}) {
  const p = new URLSearchParams();
  if (scope) p.set('scope', scope);
  if (status) p.set('status', status);
  if (severity) p.set('severity', severity);
  if (category) p.set('category', category);
  if (impact) p.set('impact', impact);
  if (search) p.set('search', search);
  if (cursor) p.set('cursor', cursor);
  if (limit) p.set('limit', String(limit));
  const qs = p.toString();
  return apiFetch(`/leader-alerts/alerts${qs ? `?${qs}` : ''}`, signal ? { signal } : undefined);
}

export async function getLeaderAlert(id) {
  return apiFetch(`/leader-alerts/alerts/${encodeURIComponent(id)}`);
}

export async function createLeaderAlert(payload) {
  return apiFetch('/leader-alerts/alerts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function patchLeaderAlert(id, patch) {
  return apiFetch(`/leader-alerts/alerts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteLeaderAlert(id) {
  return apiFetch(`/leader-alerts/alerts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── Acks ──────────────────────────────────────────────────────────────────

export async function ackLeaderAlert(id) {
  return apiFetch(`/leader-alerts/alerts/${encodeURIComponent(id)}/ack`, { method: 'POST' });
}

export async function unackLeaderAlert(id) {
  return apiFetch(`/leader-alerts/alerts/${encodeURIComponent(id)}/ack`, { method: 'DELETE' });
}

// ── Comments ──────────────────────────────────────────────────────────────

export async function listLeaderAlertComments(alertId, { since, limit } = {}) {
  const p = new URLSearchParams();
  if (since) p.set('since', since);
  if (limit) p.set('limit', String(limit));
  const qs = p.toString();
  return apiFetch(`/leader-alerts/alerts/${encodeURIComponent(alertId)}/comments${qs ? `?${qs}` : ''}`);
}

export async function postLeaderAlertComment(alertId, payload) {
  return apiFetch(`/leader-alerts/alerts/${encodeURIComponent(alertId)}/comments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function patchLeaderAlertComment(commentId, body) {
  return apiFetch(`/leader-alerts/comments/${encodeURIComponent(commentId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ body }),
  });
}

export async function deleteLeaderAlertComment(commentId) {
  return apiFetch(`/leader-alerts/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' });
}

export async function reactToComment(commentId, emoji) {
  return apiFetch(`/leader-alerts/comments/${encodeURIComponent(commentId)}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  });
}

export async function unreactComment(commentId, emoji) {
  return apiFetch(`/leader-alerts/comments/${encodeURIComponent(commentId)}/reactions?emoji=${encodeURIComponent(emoji)}`, {
    method: 'DELETE',
  });
}

// ── Followers / mute ─────────────────────────────────────────────────────

export async function muteLeaderAlertThread(alertId, muted = true) {
  return apiFetch(`/leader-alerts/alerts/${encodeURIComponent(alertId)}/followers`, {
    method: 'POST',
    body: JSON.stringify({ mute: muted }),
  });
}

export async function unfollowLeaderAlert(alertId) {
  return apiFetch(`/leader-alerts/alerts/${encodeURIComponent(alertId)}/followers`, {
    method: 'DELETE',
  });
}

// ── Sidebar badge ────────────────────────────────────────────────────────

export async function getLeaderAlertsUnackedCount() {
  return apiFetch('/leader-alerts/unacked-count');
}

// ── Settings ──────────────────────────────────────────────────────────────

export async function getLeaderAlertsSettings({ signal } = {}) {
  return apiFetch('/leader-alerts/settings', signal ? { signal } : undefined);
}

export async function putLeaderAlertsSettings(key, value) {
  return apiFetch(`/leader-alerts/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}
