import { apiFetch } from './api';

export async function fetchMembers({ role, region, isActive, cursor, limit } = {}) {
  const params = new URLSearchParams();
  if (role) params.set('role', role);
  if (region) params.set('region', region);
  if (isActive !== undefined) params.set('isActive', String(isActive));
  if (cursor) params.set('cursor', cursor);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return apiFetch(`/members${qs ? `?${qs}` : ''}`);
}

export async function fetchMemberById(id) {
  return apiFetch(`/members/${id}`);
}

export async function createMember(payload) {
  return apiFetch('/members', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateMember(id, fields) {
  return apiFetch(`/members/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export async function deactivateMember(id) {
  return apiFetch(`/members/${id}/deactivate`, { method: 'PATCH' });
}
