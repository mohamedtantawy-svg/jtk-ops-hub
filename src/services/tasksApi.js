import { apiFetch } from './api';

export async function fetchTasks({ status, source, country, sla, search, page, limit } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (source) params.set('source', source);
  if (country) params.set('country', country);
  if (sla) params.set('sla', sla);
  if (search) params.set('search', search);
  if (page) params.set('page', String(page));
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return apiFetch(`/tasks${qs ? `?${qs}` : ''}`);
}

export async function fetchTaskById(id) {
  return apiFetch(`/tasks/${id}`);
}

export async function createTask(payload) {
  return apiFetch('/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateTaskStatus(id, status) {
  return apiFetch(`/tasks/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function assignTask(id, assigneeId) {
  return apiFetch(`/tasks/${id}/assign`, {
    method: 'PATCH',
    body: JSON.stringify({ assigneeId }),
  });
}

export async function escalateTask(id, managerId, reason) {
  return apiFetch(`/tasks/${id}/escalate`, {
    method: 'PATCH',
    body: JSON.stringify({ managerId, reason }),
  });
}

export async function snoozeTask(id, until) {
  return apiFetch(`/tasks/${id}/snooze`, {
    method: 'PATCH',
    body: JSON.stringify({ until }),
  });
}

export async function deleteTask(id) {
  return apiFetch(`/tasks/${id}`, { method: 'DELETE' });
}
