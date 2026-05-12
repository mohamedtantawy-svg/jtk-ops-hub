// Frontend client for /api/v1/workspaces/* endpoints. Lives in _shared/ so
// each workspace's admin UI consumes the same API contract.
//
// Auth: pulls the JWT from localStorage (set by /auth/callback) and attaches
// it as Authorization: Bearer. Mirrors HR's apiFetch behavior at a minimum —
// we deliberately don't import HR's apiFetch (workspace isolation), but we
// follow the same token convention.

const BASE = '/api/v1/workspaces';

function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  try {
    const token = localStorage.getItem('ops_hub_token');
    if (token) h.Authorization = `Bearer ${token}`;
  } catch {}
  return h;
}

async function jsonOrThrow(res) {
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(body?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export async function fetchMemberships() {
  const res = await fetch(`${BASE}/memberships`, { headers: authHeaders(), credentials: 'same-origin' });
  return jsonOrThrow(res);
}

export async function listWorkspaceMembers(workspaceId, { search = '', limit = 50, offset = 0 } = {}) {
  const url = new URL(`${BASE}/${encodeURIComponent(workspaceId)}/members`, window.location.origin);
  if (search) url.searchParams.set('search', search);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  const res = await fetch(url.toString(), { headers: authHeaders(), credentials: 'same-origin' });
  return jsonOrThrow(res);
}

export async function addWorkspaceMember(workspaceId, email, role = 'member') {
  const res = await fetch(`${BASE}/${encodeURIComponent(workspaceId)}/members`, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'same-origin',
    body: JSON.stringify({ email, role }),
  });
  return jsonOrThrow(res);
}

export async function removeWorkspaceMember(workspaceId, email) {
  const res = await fetch(
    `${BASE}/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(email)}`,
    { method: 'DELETE', headers: authHeaders(), credentials: 'same-origin' },
  );
  return jsonOrThrow(res);
}

export async function updateWorkspaceMemberRole(workspaceId, email, role) {
  const res = await fetch(
    `${BASE}/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(email)}`,
    {
      method: 'PATCH',
      headers: authHeaders(),
      credentials: 'same-origin',
      body: JSON.stringify({ role }),
    },
  );
  return jsonOrThrow(res);
}
