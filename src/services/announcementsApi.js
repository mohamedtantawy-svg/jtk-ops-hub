// ── Announcements API service ─────────────────────────────────────────────────
// Wraps all announcement-related API calls. Falls back to local state when the
// backend is unreachable so the app keeps working in offline / demo mode.

import { apiFetch } from './api';

// ── List announcements ───────────────────────────────────────────────────────
export async function fetchAnnouncements({ status, target, limit } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', Array.isArray(status) ? status.join(',') : status);
  if (target) params.set('target', target);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return apiFetch(`/announcements${qs ? `?${qs}` : ''}`);
}

// ── Get single announcement ──────────────────────────────────────────────────
export async function fetchAnnouncementById(id) {
  return apiFetch(`/announcements/${id}`);
}

// ── Create announcement ──────────────────────────────────────────────────────
// Approvers may additionally pass { scheduledFor, urgentOverride } to schedule
// for later or override the 2/day + 4h-gap rate limits.
export async function createAnnouncement(payload) {
  const {
    type, title, body, target, priority, isPopup, imageUrl, link, soundKey,
    scheduledFor, urgentOverride, urgentOverrideReason,
  } = payload || {};
  return apiFetch('/announcements', {
    method: 'POST',
    body: JSON.stringify({
      type, title, body, target, priority, isPopup, imageUrl, link, soundKey,
      scheduledFor: scheduledFor || null,
      urgentOverride: urgentOverride || false,
      urgentOverrideReason: urgentOverrideReason || '',
    }),
  });
}

// ── Update announcement ──────────────────────────────────────────────────────
export async function updateAnnouncement(id, fields) {
  return apiFetch(`/announcements/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

// ── Send announcement ────────────────────────────────────────────────────────
export async function sendAnnouncement(id) {
  return apiFetch(`/announcements/${id}/send`, { method: 'PATCH' });
}

// ── Mark as read / acknowledged ──────────────────────────────────────────────
// The DB persists announcements with UUID primary keys. Seed-only IDs like
// `COM-001` (the demo announcements baked into FE state) hit the route and
// blow up Postgres with `invalid input syntax for type uuid`. They also
// spam the origin-check warning. Skip the call client-side when the id
// isn't a UUID — there's nothing to mark read on the server, and the FE
// state already updated optimistically.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function acknowledgeAnnouncement(id) {
  if (!id || typeof id !== 'string' || !UUID_RE.test(id)) {
    // Resolve as a no-op for seed/demo ids so callers keep working without
    // a try/catch dance.
    return { ok: true, skipped: 'non-uuid-id', id };
  }
  return apiFetch(`/announcements/${id}/read`, { method: 'POST' });
}

// ── Delete announcement ──────────────────────────────────────────────────────
export async function deleteAnnouncement(id) {
  return apiFetch(`/announcements/${id}`, { method: 'DELETE' });
}

// ── Unarchive announcement ──────────────────────────────────────────────────
export async function unarchiveAnnouncement(id) {
  return apiFetch(`/announcements/${id}/unarchive`, { method: 'PATCH' });
}

// ── Comments ────────────────────────────────────────────────────────────────
export async function fetchComments(announcementId) {
  return apiFetch(`/announcements/${announcementId}/comments`);
}

export async function addComment(announcementId, { body, parentId, mentionEmails } = {}) {
  return apiFetch(`/announcements/${announcementId}/comments`, {
    method: 'POST',
    body: JSON.stringify({
      body,
      parentId: parentId || null,
      mentionEmails: Array.isArray(mentionEmails) ? mentionEmails : [],
    }),
  });
}

export async function deleteComment(announcementId, commentId) {
  return apiFetch(`/announcements/${announcementId}/comments/${commentId}`, { method: 'DELETE' });
}

// ── Linked announcements ────────────────────────────────────────────────────
export async function fetchLinks(id) {
  return apiFetch(`/announcements/${id}/links`);
}

export async function linkAnnouncement(id, targetId) {
  return apiFetch(`/announcements/${id}/links`, {
    method: 'POST',
    body: JSON.stringify({ targetId }),
  });
}

export async function unlinkAnnouncement(id, targetId) {
  return apiFetch(`/announcements/${id}/links/${targetId}`, { method: 'DELETE' });
}

// ── Reactions ──────────────────────────────────────────────────────────────
export async function reactToAnnouncement(id, emoji) {
  return apiFetch(`/announcements/${id}/react`, {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  });
}
