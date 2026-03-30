import { apiFetch } from './api';

export async function fetchEscalations({ status, severity, source, managerId, taskId, cursor, limit } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (severity) params.set('severity', severity);
  if (source) params.set('source', source);
  if (managerId) params.set('managerId', String(managerId));
  if (taskId) params.set('taskId', taskId);
  if (cursor) params.set('cursor', cursor);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return apiFetch(`/escalations${qs ? `?${qs}` : ''}`);
}

export async function fetchEscalationById(id) {
  return apiFetch(`/escalations/${id}`);
}

export async function createEscalation({ taskId, subject, reason, managerId }) {
  return apiFetch('/escalations', {
    method: 'POST',
    body: JSON.stringify({ taskId, subject, reason, managerId }),
  });
}

export async function respondToEscalation(id, response) {
  return apiFetch(`/escalations/${id}/respond`, {
    method: 'PATCH',
    body: JSON.stringify({ response }),
  });
}

export async function resolveEscalation(id) {
  return apiFetch(`/escalations/${id}/resolve`, { method: 'PATCH' });
}

export async function dismissEscalation(id) {
  return apiFetch(`/escalations/${id}/dismiss`, { method: 'PATCH' });
}
