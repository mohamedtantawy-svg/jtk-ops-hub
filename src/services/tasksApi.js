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
