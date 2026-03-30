// ── Base API client ──────────────────────────────────────────────────────────
// All fetch calls go through this wrapper so we can handle auth, errors, and
// base-URL configuration in one place.

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

/**
 * Thin wrapper around fetch that:
 * - Prepends the API base URL
 * - Attaches the JWT from localStorage
 * - Auto-parses JSON responses
 * - Throws on non-2xx with a structured error
 */
export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('ops_hub_token');

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  // 204 No Content
  if (res.status === 204) return null;

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const err = new Error(body?.error || body?.message || `API ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }

  return body;
}
