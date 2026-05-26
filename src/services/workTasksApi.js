// ── Work Tasks API client (Phase 1, 2026-05-25) ────────────────────────────
// Thin wrappers over apiFetch. Mirrors the shape used by orgApi / hrHubApi
// so call sites stay consistent across the codebase.

import { apiFetch } from './api';

function qs(obj) {
  const parts = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (v == null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

export async function listWorkTasks({
  status, priority, scope, q, projectId, includeArchived, limit,
} = {}) {
  const query = qs({
    status, priority, scope, q,
    project_id: projectId,
    include_archived: includeArchived ? 1 : null,
    limit,
  });
  return apiFetch(`/work-tasks${query}`);
}

export async function createWorkTask(payload) {
  return apiFetch('/work-tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getWorkTask(taskId) {
  return apiFetch(`/work-tasks/${encodeURIComponent(taskId)}`);
}

export async function patchWorkTask(taskId, patch) {
  return apiFetch(`/work-tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function archiveWorkTask(taskId) {
  return apiFetch(`/work-tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
}

export async function listWorkTaskComments(taskId, { since, limit } = {}) {
  const query = qs({ since, limit });
  return apiFetch(`/work-tasks/${encodeURIComponent(taskId)}/comments${query}`);
}

export async function createWorkTaskComment(taskId, { body, mentions }) {
  return apiFetch(`/work-tasks/${encodeURIComponent(taskId)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body, mentions }),
  });
}

// ── Phase 3 — Projects ──────────────────────────────────────────────────
export async function listWorkProjects({ includeArchived } = {}) {
  const query = qs({ include_archived: includeArchived ? 1 : null });
  return apiFetch(`/work-projects${query}`);
}

export async function createWorkProject(payload) {
  return apiFetch('/work-projects', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function patchWorkProject(projectId, patch) {
  return apiFetch(`/work-projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function archiveWorkProject(projectId) {
  return apiFetch(`/work-projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
}

// ── Legacy-checklist recovery ──────────────────────────────────────────────
// Posts the caller's still-present localStorage checklist items to the
// server, which merges them into personal_checklist_snapshots, clears the
// migration sentinel, and re-runs the migration helper. Returns
// { snapshotItems, incomingItems, migrated, skipped }.
// Celine Taruc 2026-05-26 — recovers PersonalChecklist items that never
// made it through the PR #821 cutover.
export async function recoverLegacyChecklist(items) {
  return apiFetch('/work-tasks/recover-legacy-checklist', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}
