// ── Feedback board API client ───────────────────────────────────────────
// Mirrors the wrapper-style of every other src/services/*Api.js file —
// thin functions over apiFetch that map FE call sites to /api/v1/feedback.
// ────────────────────────────────────────────────────────────────────────

import { apiFetch } from './api';

export async function listFeedback({ status, category, type, sort } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (category) params.set('category', category);
  if (type) params.set('type', type);
  if (sort) params.set('sort', sort);
  const qs = params.toString();
  return apiFetch(`/feedback${qs ? `?${qs}` : ''}`);
}

export async function getFeedback(id) {
  return apiFetch(`/feedback/${encodeURIComponent(id)}`);
}

export async function createFeedback(payload) {
  return apiFetch('/feedback', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateFeedback(id, patch) {
  return apiFetch(`/feedback/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteFeedback(id) {
  return apiFetch(`/feedback/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// vote ∈ {1, -1, 0}; 0 clears the user's vote on this request.
export async function voteFeedback(id, vote) {
  return apiFetch(`/feedback/${encodeURIComponent(id)}/vote`, {
    method: 'POST',
    body: JSON.stringify({ vote }),
  });
}

export async function listComments(id) {
  return apiFetch(`/feedback/${encodeURIComponent(id)}/comments`);
}

export async function addComment(id, body) {
  return apiFetch(`/feedback/${encodeURIComponent(id)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}
