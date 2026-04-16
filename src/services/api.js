// ── Base API client ──────────────────────────────────────────────────────────
// All fetch calls go through this wrapper so we can handle auth, errors, and
// base-URL configuration in one place. Includes retry with backoff for
// transient failures (network errors, 5xx).

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';
const MAX_RETRIES = 2; // up to 3 total attempts
const BASE_DELAY = 600; // ms

/**
 * Thin wrapper around fetch that:
 * - Prepends the API base URL
 * - Attaches the JWT from localStorage
 * - Auto-parses JSON responses
 * - Retries on network errors and 5xx (up to 3 attempts)
 * - Throws on non-2xx with a structured error
 */
export async function apiFetch(path, options = {}) {
  let token = null;
  if (typeof window !== 'undefined') { try { token = localStorage.getItem('ops_hub_token'); } catch {} }

  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
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

        // 401 — token expired or invalid
        if (res.status === 401) {
          if (typeof window !== 'undefined') {
            // Only invalidate the session when the token is ACTUALLY expired.
            // Transient 401s (cold-start, middleware timing, etc.) must NOT
            // nuke a valid session — verify expiry locally before clearing.
            try {
              const currentToken = localStorage.getItem('ops_hub_token');
              if (token && currentToken === token) {
                // Decode the JWT and check expiry locally
                let isExpired = false;
                try {
                  const payload = JSON.parse(atob(currentToken.split('.')[1]));
                  const now = Math.floor(Date.now() / 1000);
                  isExpired = payload.exp && payload.exp < now;
                } catch {
                  isExpired = true; // malformed token
                }

                if (isExpired) {
                  localStorage.removeItem('ops_hub_token');
                  localStorage.removeItem('ops_hub_token_ts');
                  localStorage.removeItem('ops_hub_user');
                  window.dispatchEvent(new CustomEvent('ops-hub-session-expired'));
                } else {
                  console.warn('[apiFetch] 401 but token not expired locally — keeping session (transient failure)');
                }
              }
            } catch {}
          }
          throw err;
        }

        // Don't retry 4xx (client errors)
        if (res.status >= 400 && res.status < 500) throw err;

        // 5xx — retry
        lastError = err;
        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err;
      }

      return body;
    } catch (err) {
      lastError = err;

      // Don't retry 4xx
      if (err.status && err.status >= 400 && err.status < 500) throw err;

      // Network error or 5xx — retry if attempts remain
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
    }
  }

  throw lastError;
}
