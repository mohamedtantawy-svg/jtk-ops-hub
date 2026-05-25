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

// Phase 8 (2026-05-20): restore a previously-archived node.
export async function restoreOrgNode(id) {
  return apiFetch(`/org/nodes/${encodeURIComponent(id)}/restore`, { method: 'POST' });
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

// ── Delegated admins (Phase 5) ───────────────────────────────────────────
export async function listNodeAdmins(id) {
  return apiFetch(`/org/nodes/${encodeURIComponent(id)}/admins`);
}
export async function grantNodeAdmin(id, email) {
  return apiFetch(`/org/nodes/${encodeURIComponent(id)}/admins`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}
export async function revokeNodeAdmin(id, email) {
  return apiFetch(`/org/nodes/${encodeURIComponent(id)}/admins`, {
    method: 'DELETE',
    body: JSON.stringify({ email }),
  });
}

// ── Per-node assignments (Phase 12a, 2026-05-25) ─────────────────────────
// SWAT Functions + Responsibilities for a department. `kind` filters the
// list ('swat_function' | 'responsibility'); omit to fetch both.
export async function listNodeAssignments(nodeId, { kind } = {}) {
  const qs = kind ? `?kind=${encodeURIComponent(kind)}` : '';
  return apiFetch(`/org/nodes/${encodeURIComponent(nodeId)}/assignments${qs}`);
}

export async function createNodeAssignment(nodeId, payload) {
  return apiFetch(`/org/nodes/${encodeURIComponent(nodeId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function patchNodeAssignment(nodeId, assignmentId, patch) {
  return apiFetch(
    `/org/nodes/${encodeURIComponent(nodeId)}/assignments/${encodeURIComponent(assignmentId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
}

export async function archiveNodeAssignment(nodeId, assignmentId) {
  return apiFetch(
    `/org/nodes/${encodeURIComponent(nodeId)}/assignments/${encodeURIComponent(assignmentId)}`,
    { method: 'DELETE' },
  );
}

// ── Vacancies (Phase 5) ──────────────────────────────────────────────────
export async function listNodeVacancies(id) {
  return apiFetch(`/org/nodes/${encodeURIComponent(id)}/vacancies`);
}
export async function addNodeVacancy(id, { title, notes }) {
  return apiFetch(`/org/nodes/${encodeURIComponent(id)}/vacancies`, {
    method: 'POST',
    body: JSON.stringify({ title, notes }),
  });
}
export async function removeNodeVacancy(id, vacancyId) {
  return apiFetch(`/org/nodes/${encodeURIComponent(id)}/vacancies`, {
    method: 'DELETE',
    body: JSON.stringify({ vacancyId }),
  });
}
