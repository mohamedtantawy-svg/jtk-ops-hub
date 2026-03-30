import { apiFetch } from './api';

export async function fetchRequests({ toTeam, status, fromMember } = {}) {
  const params = new URLSearchParams();
  if (toTeam) params.set('toTeam', toTeam);
  if (status) params.set('status', status);
  if (fromMember) params.set('fromMember', String(fromMember));
  const qs = params.toString();
  return apiFetch(`/requests${qs ? `?${qs}` : ''}`);
}

export async function fetchRequestById(id) {
  return apiFetch(`/requests/${id}`);
}

export async function createRequest(payload) {
  return apiFetch('/requests', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateRequest(id, fields) {
  return apiFetch(`/requests/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export async function deleteRequest(id) {
  return apiFetch(`/requests/${id}`, { method: 'DELETE' });
}
