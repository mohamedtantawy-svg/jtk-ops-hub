// ── HR Hub API client ────────────────────────────────────────────────────
// Thin wrappers over apiFetch — same shape as the other service modules so
// FE call sites read consistently across queues. See HR_HUB_PLAN.md for
// the route-by-route contract these functions cover.

import { apiFetch } from './api';

// ── Requests ───────────────────────────────────────────────────────────────

export async function listHrHubRequests({ flow, scope = 'mine', status, functionArea, search, assignee, cursor, limit } = {}) {
  const p = new URLSearchParams();
  if (flow) p.set('flow', flow);
  if (scope) p.set('scope', scope);
  if (status) p.set('status', status);
  if (functionArea) p.set('function', functionArea);
  if (search) p.set('search', search);
  // 'unassigned' = NULL/empty assignee_email; an email = exact match.
  // null/undefined = picker cleared → no extra predicate.
  if (assignee) p.set('assignee', assignee);
  if (cursor) p.set('cursor', cursor);
  if (limit) p.set('limit', String(limit));
  const qs = p.toString();
  return apiFetch(`/hr-hub/requests${qs ? `?${qs}` : ''}`);
}

export async function getHrHubRequest(id) {
  return apiFetch(`/hr-hub/requests/${encodeURIComponent(id)}`);
}

// Returns { byStatus: { new, in_progress, on_hold, resolved, rejected, total },
//           byScope:  { all, mine, team, assigned, mentioned } }
// where byStatus respects scope/flow/search and byScope is pending-only
// (excludes resolved + rejected per the 2026-05-04 spec). Replaces the
// two `listHrHubRequests({ limit: 100 })` calls HrHubView used to count
// from — those counted a TRUNCATED list (the list route caps at 100), so
// once a workspace crossed ~100 rows the totals stopped matching reality.
export async function getHrHubRequestCounts({ flow, scope = 'mine', search, assignee } = {}) {
  const p = new URLSearchParams();
  if (flow) p.set('flow', flow);
  if (scope) p.set('scope', scope);
  if (search) p.set('search', search);
  if (assignee) p.set('assignee', assignee);
  const qs = p.toString();
  return apiFetch(`/hr-hub/requests/counts${qs ? `?${qs}` : ''}`);
}

export async function createHrHubRequest(payload) {
  return apiFetch('/hr-hub/requests', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function patchHrHubRequest(id, patch) {
  return apiFetch(`/hr-hub/requests/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

// ── Comments ───────────────────────────────────────────────────────────────

export async function listHrHubComments(requestId, { since, limit } = {}) {
  const p = new URLSearchParams();
  if (since) p.set('since', since);
  if (limit) p.set('limit', String(limit));
  const qs = p.toString();
  return apiFetch(`/hr-hub/requests/${encodeURIComponent(requestId)}/comments${qs ? `?${qs}` : ''}`);
}

export async function postHrHubComment(requestId, payload) {
  return apiFetch(`/hr-hub/requests/${encodeURIComponent(requestId)}/comments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function patchHrHubComment(commentId, body) {
  return apiFetch(`/hr-hub/comments/${encodeURIComponent(commentId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ body }),
  });
}

export async function deleteHrHubComment(commentId) {
  return apiFetch(`/hr-hub/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' });
}

// ── Followers ──────────────────────────────────────────────────────────────

export async function followHrHubRequest(requestId, email) {
  return apiFetch(`/hr-hub/requests/${encodeURIComponent(requestId)}/followers`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function unfollowHrHubRequest(requestId, email) {
  return apiFetch(
    `/hr-hub/requests/${encodeURIComponent(requestId)}/followers/${encodeURIComponent(email)}`,
    { method: 'DELETE' },
  );
}

// ── Settings ───────────────────────────────────────────────────────────────

export async function getHrHubSettings(flow) {
  return apiFetch(`/hr-hub/settings/${encodeURIComponent(flow)}`);
}

export async function putHrHubSettings(flow, payload) {
  return apiFetch(`/hr-hub/settings/${encodeURIComponent(flow)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}
