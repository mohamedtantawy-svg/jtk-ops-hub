// ── Announcement requests API service ─────────────────────────────────────
// Wraps the /announcement-requests endpoints (approval queue).
import { apiFetch } from './api';

// List — backend scopes automatically (approver sees all, requester sees own)
export async function fetchRequests({ status, scope } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', Array.isArray(status) ? status.join(',') : status);
  if (scope) params.set('scope', scope);
  const qs = params.toString();
  return apiFetch(`/announcement-requests${qs ? `?${qs}` : ''}`);
}

export async function fetchRequestDetail(id) {
  return apiFetch(`/announcement-requests/${id}`);
}

export async function createRequest(payload) {
  return apiFetch('/announcement-requests', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function editRequest(id, patch) {
  return apiFetch(`/announcement-requests/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function approveRequest(id, { scheduledFor, urgentOverride, overrideEdits } = {}) {
  return apiFetch(`/announcement-requests/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ scheduledFor, urgentOverride, overrideEdits }),
  });
}

export async function rejectRequest(id, reason) {
  return apiFetch(`/announcement-requests/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function requestInfo(id, question) {
  return apiFetch(`/announcement-requests/${id}/request-info`, {
    method: 'POST',
    body: JSON.stringify({ question }),
  });
}

export async function withdrawRequest(id) {
  return apiFetch(`/announcement-requests/${id}/withdraw`, { method: 'POST' });
}

export async function fetchRequestComments(id) {
  return apiFetch(`/announcement-requests/${id}/comments`);
}

export async function addRequestComment(id, body) {
  return apiFetch(`/announcement-requests/${id}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}
