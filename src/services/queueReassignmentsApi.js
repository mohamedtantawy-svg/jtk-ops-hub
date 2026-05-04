// ── Queue source reassignment API client ────────────────────────────────────
// Thin wrappers around /api/v1/queue/source-reassign for the four Deel
// queues (onboarding, amendments, redlines, incentive_plans) that don't
// support upstream reassignment. Pass `null` for assigneeEmail to clear an
// existing override and revert to the upstream-assigned member.

import { apiFetch } from './api';

export async function listSourceReassignments(source) {
  const qs = source ? `?source=${encodeURIComponent(source)}` : '';
  return apiFetch(`/queue/source-reassign${qs}`);
}

export async function reassignSourceTask({
  source,
  taskId,
  taskUrl,
  taskSubject,
  taskCountry,
  assigneeEmail,
  assigneeName,
  originalAssigneeEmail,
  originalAssigneeName,
}) {
  return apiFetch('/queue/source-reassign', {
    method: 'POST',
    body: JSON.stringify({
      source,
      taskId,
      taskUrl: taskUrl || null,
      taskSubject: taskSubject || null,
      taskCountry: taskCountry || null,
      assigneeEmail: assigneeEmail || null,
      assigneeName: assigneeName || null,
      originalAssigneeEmail: originalAssigneeEmail || null,
      originalAssigneeName: originalAssigneeName || null,
    }),
  });
}

export async function clearSourceReassignment({ source, taskId }) {
  return reassignSourceTask({ source, taskId, assigneeEmail: null });
}
