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

export async function approveRequest(id, {
  scheduledFor,
  urgentOverride,
  urgentOverrideReason,
  overrideEdits,
  // 2026-05-12 two-stage flow: default is false (approve into
  // awaiting_post; requester drives the final publish). Pass true to
  // bypass the Slack-first step and publish inline (legacy
  // one-shot behaviour).
  publishImmediately,
} = {}) {
  return apiFetch(`/announcement-requests/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({
      scheduledFor,
      urgentOverride,
      urgentOverrideReason,
      overrideEdits,
      publishImmediately: publishImmediately === true,
    }),
  });
}

// 2026-05-12 stage 2: requester (or approver) drives the final publish
// from awaiting_post. Server reuses the approval-time payload — no body
// fields needed.
export async function publishApprovedRequest(id) {
  return apiFetch(`/announcement-requests/${id}/publish`, { method: 'POST' });
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
