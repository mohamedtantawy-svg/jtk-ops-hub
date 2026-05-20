// ── Org API client (Phase 1, 2026-05-20) ───────────────────────────────────
// Thin wrappers over apiFetch. The shape mirrors hrHubApi.js so call sites
// stay consistent across queues. See app/api/v1/org/nodes/* for the
// route-by-route contracts.

import { apiFetch } from './api';

// ── Nodes ────────────────────────────────────────────────────────────────

export async function listOrgNodes({ includeArchived = false } = {}) {
  const qs = includeArchived ? '?include_archived=1' : '';
  return apiFetch(`/org/nodes${qs}`);
}

export async function getOrgNode(id) {
  return apiFetch(`/org/nodes/${encodeURIComponent(id)}`);
}

export async function createOrgNode(payload) {
  return apiFetch('/org/nodes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function patchOrgNode(id, patch) {
  return apiFetch(`/org/nodes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function archiveOrgNode(id) {
  return apiFetch(`/org/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function moveOrgNode(id, { parentId }) {
  return apiFetch(`/org/nodes/${encodeURIComponent(id)}/move`, {
    method: 'POST',
    body: JSON.stringify({ parentId }),
  });
}

export async function reorderOrgNode(id, newSortOrder) {
  return apiFetch(`/org/nodes/${encodeURIComponent(id)}/reorder`, {
    method: 'POST',
    body: JSON.stringify({ newSortOrder }),
  });
}
