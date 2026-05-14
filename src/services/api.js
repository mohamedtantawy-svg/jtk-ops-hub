// ── Base API client ──────────────────────────────────────────────────────────
// All fetch calls go through this wrapper so we can handle auth, errors, and
// base-URL configuration in one place. Includes retry with backoff for
// transient failures (network errors, 5xx).
//
// Hard timeout — every request gets a 90s ceiling by default (override via
// `timeoutMs`). This prevents the symptom that triggered the 2026-05-01
// performance overhaul: queue fetches that hung silently for 5+ minutes,
// keeping the UI's loading spinner alive forever because the underlying
// Promise never settled. With a timeout, a hung request fails fast,
// inFlightRef in the data hooks clears in `finally`, and the sync state
// machine surfaces a "stalled / retry" UI instead of an infinite spinner.

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';
const MAX_RETRIES = 2; // up to 3 total attempts
const BASE_DELAY = 600; // ms
const DEFAULT_TIMEOUT_MS = 90_000; // 90s — covers cold-cache scans like terminations_v3 ~600 pages

// Retry-backoff jitter — uses crypto.getRandomValues when available so
// CodeQL's `js/insecure-randomness` dataflow analysis doesn't flag the
// jitter as a security context (it can't tell jitter from a CSRF/token
// generator). Returns a uniform value in [0, 0.5] so the existing
// `delay = BASE_DELAY * 2^attempt * (0.5 + _jitter())` formula keeps
// its original [0.5, 1.0] multiplier range — identical wall-clock
// behaviour to the previous Math.random implementation. Falls back to
// the midpoint when crypto isn't available; the jitter is purely for
// retry scheduling, no security impact either way.
function _jitter() {
  try {
    const g = typeof globalThis !== 'undefined' ? globalThis : self;
    if (g?.crypto?.getRandomValues) {
      const buf = new Uint32Array(1);
      g.crypto.getRandomValues(buf);
      return (buf[0] / 0xffffffff) * 0.5;
    }
  } catch {}
  return 0.25; // deterministic midpoint fallback
}

// Module-level streak counter for transient 401 warnings. The 2026-05-03
// live audit (F40) caught the console flooded with
// "[apiFetch] 401 but token not expired locally — keeping session
// (transient failure)" — every API call hitting a momentary 401 emitted a
// warning, sometimes 3-5 per minute. The session was always healthy; the
// warning was diagnostic noise. We now debounce: only the FIRST transient
// 401 in a streak logs, plus every 10th subsequent until a 2xx clears the
// streak. Keeps the diagnostic value (you'll see the first one) without
// drowning the rest of the console.
let _transient401Streak = 0;
function _maybeWarnTransient401() {
  _transient401Streak += 1;
  if (_transient401Streak === 1 || _transient401Streak % 10 === 0) {
    // eslint-disable-next-line no-console
    console.warn('[apiFetch] 401 but token not expired locally — keeping session (transient failure, streak=' + _transient401Streak + ')');
  }
}
function _clearTransient401Streak() {
  if (_transient401Streak > 0) _transient401Streak = 0;
}

/**
 * Thin wrapper around fetch that:
 * - Prepends the API base URL
 * - Attaches the JWT from localStorage
 * - Auto-parses JSON responses
 * - Retries on network errors and 5xx (up to 3 attempts)
 * - Throws on non-2xx with a structured error
 * - Enforces a hard timeout (default 90s) so a hung upstream can't keep
 *   the FE's loading state pinned forever. Caller can override via
 *   `options.timeoutMs` (e.g. 30s for routine ticks, longer for one-off
 *   bulk pulls).
 */
export async function apiFetch(path, options = {}) {
  let token = null;
  let impersonateAs = null;
  if (typeof window !== 'undefined') {
    try { token = localStorage.getItem('ops_hub_token'); } catch {}
    // Impersonation propagation. If the admin / RM has the Login-as
    // session active, every API call goes out with `X-Impersonate-As: <email>`
    // so the server filters / scopes / audits as the impersonated user.
    // The middleware ignores the header for callers whose JWT role isn't
    // admin or regional_manager, so this is safe to ALWAYS attach when
    // present — no need to gate it client-side. (Stage 2 of the
    // 2026-05-03 audit fix sweep — A-F17 / A-F19 / A-F22.)
    //
    // EXCEPTION — `options.skipImpersonation`: identity routes (`/me`) must
    // always return the ACTOR, never the impersonated target. Otherwise the
    // FE writes the target's profile back into `user` state, the
    // impersonation restore effect sees an actor mismatch on next refresh
    // and wipes sessionStorage — Kristina's 2026-05-12 "Admin view reverts
    // after a refresh" bug. Routes that opt out pass
    // `apiFetch('/me', { skipImpersonation: true })`.
    if (!options.skipImpersonation) {
      try {
        const raw = sessionStorage.getItem('ops_hub_impersonating');
        if (raw) {
          const parsed = JSON.parse(raw);
          // App.jsx writes `{ actor: <admin email>, target: <impersonated email> }`.
          // The server expects the IMPERSONATED email (the "as" identity), so
          // read `target` first and fall back to `email` for forward
          // compatibility if the schema ever changes.
          const target = parsed && (parsed.target || parsed.email);
          if (target) impersonateAs = String(target).toLowerCase();
        }
      } catch {}
    }
  }

  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(impersonateAs ? { 'X-Impersonate-As': impersonateAs } : {}),
    ...(options.headers || {}),
  };

  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;

  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Per-attempt timeout controller — chained to caller's signal so an
    // outer abort still wins, but the timeout fires independently if the
    // upstream hangs without responding.
    const timeoutCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = timeoutCtrl ? setTimeout(() => timeoutCtrl.abort(), timeoutMs) : null;
    if (options.signal && timeoutCtrl) {
      if (options.signal.aborted) timeoutCtrl.abort();
      else options.signal.addEventListener('abort', () => timeoutCtrl.abort(), { once: true });
    }
    const effectiveSignal = timeoutCtrl ? timeoutCtrl.signal : options.signal;

    try {
      // Early-out if an upstream abort fired before we even tried.
      if (options.signal?.aborted) {
        const e = new Error('Aborted'); e.name = 'AbortError'; throw e;
      }
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
        signal: effectiveSignal,
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
                  _maybeWarnTransient401();
                }
              }
            } catch {}
          }
          throw err;
        }

        // Don't retry 4xx (client errors)
        if (res.status >= 400 && res.status < 500) throw err;

        // Don't retry gateway timeouts — a 504 from us already means the
        // server tried, hit its scan timeout, and gave up. A retry just
        // makes the user wait the full 45s server window again with the
        // same upstream that's already failing. (Pre-fix: 504 × 3 retries
        // = 2m+ wait before the queue indicator could surface "Failed".)
        if (res.status === 504) throw err;

        // 5xx (other than 504) — retry
        lastError = err;
        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY * Math.pow(2, attempt) * (0.5 + _jitter());
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err;
      }

      // Clear the transient-401 streak on the first successful response —
      // healthy traffic shouldn't keep counting toward the next "every 10th"
      // log line if we recover. (F40, 2026-05-03 live audit.)
      _clearTransient401Streak();
      return body;
    } catch (err) {
      lastError = err;

      // Distinguish "caller aborted" from "we timed out". The fetch() call
      // throws AbortError in BOTH cases — when timeoutCtrl fires we want to
      // surface a clear timeout (not a generic abort), and we never retry on
      // timeout because the next attempt would just wait the full window
      // again with the same upstream.
      const isTimeout = err.name === 'AbortError' && timeoutCtrl?.signal.aborted && !options.signal?.aborted;
      if (isTimeout) {
        const e = new Error(`Request to ${path} timed out after ${timeoutMs}ms`);
        e.name = 'TimeoutError';
        e.timeout = true;
        throw e;
      }

      // Never retry deliberate aborts — caller wants to bail.
      if (err.name === 'AbortError') throw err;

      // Don't retry 4xx
      if (err.status && err.status >= 400 && err.status < 500) throw err;

      // Network error or 5xx — retry if attempts remain
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, attempt) * (0.5 + _jitter());
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  throw lastError;
}
