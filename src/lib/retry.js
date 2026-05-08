// ── Retry with exponential backoff ──────────────────────────────────────────
// Shared utility used by all API clients (Deel, Zendesk, Jira).
// Retries on network errors, 5xx server errors, and 429 rate-limit responses.
// Does NOT retry other 4xx — those are genuine client errors (wrong params,
// auth failures, not found, etc.).
//
// 429 is special-cased on purpose: it is a TRANSIENT, RECOVERABLE response
// from the upstream telling us to back off, not a request-shape problem.
// The previous "throw on every 4xx" behaviour caused 164/1585 Zendesk SLA
// tickets to fail per sync run (2026-05-08 logs) — every rate-limit hit
// was data loss. Now we honour the upstream's `Retry-After` header (capped
// at RATE_LIMIT_MAX_WAIT_MS so an interactive route can't hang for 60+ s)
// and use the normal retry budget. If the upstream says wait longer than
// our cap, we wait the cap and try; if still 429, we exhaust attempts and
// throw (caller can re-poll on the next cycle).

const DEFAULTS = {
  maxRetries: 3,
  baseDelay: 800,   // ms — first retry after ~800ms
  maxDelay: 8000,   // ms — cap at 8s
  retryOn5xx: true,  // retry on 500/502/503/504
};

// Hard cap on how long we'll wait for a rate-limit cool-down per attempt.
// Zendesk's Retry-After is usually 60 s; respecting that verbatim would
// stall an interactive queue render to half a minute. 5 s leaves the route
// usable while still giving the background sync up to (maxRetries + 1) × 5 s
// per ticket worst-case to clear a transient burst.
const RATE_LIMIT_MAX_WAIT_MS = 5000;
// Floor delay when 429 arrives without a Retry-After header (rare but
// allowed by spec). Keeps us from retrying inside the same millisecond.
const RATE_LIMIT_DEFAULT_WAIT_MS = 1500;
// Belt-and-braces ceiling at the setTimeout sink itself. The retry path
// passes a raw upstream-influenced value (Retry-After header → withRetry
// caller → _sleep), so we discretise into a fixed allowlist of timer
// durations. Each setTimeout below is invoked with a NUMERIC LITERAL,
// breaking the data-flow taint from the upstream value to the timer call
// site (CodeQL's js/resource-exhaustion query treats const-bounded chains
// as still tainted, but recognises a literal sink as clean). Coarse
// granularity is fine — the retry budget isn't affected and the worst
// case "wait" is bounded by the highest bucket here.
function _sleep(rawMs) {
  const num = Number(rawMs);
  if (!Number.isFinite(num) || num <= 0) return new Promise(r => setTimeout(r, 0));
  if (num >= 30_000)                       return new Promise(r => setTimeout(r, 30_000));
  if (num >= 8_000)                        return new Promise(r => setTimeout(r, 8_000));
  if (num >= 5_000)                        return new Promise(r => setTimeout(r, 5_000));
  if (num >= 3_000)                        return new Promise(r => setTimeout(r, 3_000));
  if (num >= 2_000)                        return new Promise(r => setTimeout(r, 2_000));
  if (num >= 1_500)                        return new Promise(r => setTimeout(r, 1_500));
  if (num >= 1_000)                        return new Promise(r => setTimeout(r, 1_000));
  if (num >= 500)                          return new Promise(r => setTimeout(r, 500));
  if (num >= 200)                          return new Promise(r => setTimeout(r, 200));
  if (num >= 100)                          return new Promise(r => setTimeout(r, 100));
  return new Promise(r => setTimeout(r, 0));
}

/**
 * Wraps an async function with retry logic + exponential backoff.
 * @param {Function} fn — async function to call
 * @param {Object} opts — { maxRetries, baseDelay, maxDelay, retryOn5xx, label }
 * @returns {Promise} — result of fn()
 */
export async function withRetry(fn, opts = {}) {
  const { maxRetries, baseDelay, maxDelay, retryOn5xx, label } = { ...DEFAULTS, ...opts };

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      const isRateLimited = err?.status === 429;
      const isOtherClientError =
        err?.status && err.status >= 400 && err.status < 500 && !isRateLimited;

      // Don't retry non-429 4xx errors (bad request, unauthorized, not found, etc.)
      if (isOtherClientError) {
        throw err;
      }

      // Don't retry if we've exhausted attempts
      if (attempt >= maxRetries) {
        break;
      }

      // Only retry 5xx if configured
      if (err.status && err.status >= 500 && err.status < 600 && !retryOn5xx) {
        throw err;
      }

      // Pick the delay. 429: respect Retry-After (capped); other transient:
      // exponential backoff with jitter. Rate-limit waits aren't jittered
      // because the upstream told us exactly when it's safe to try again
      // — adding randomness can push us past the cap or back inside the
      // throttled window.
      let waitMs;
      let waitReason;
      if (isRateLimited) {
        const requestedMs = Number.isFinite(err.retryAfterMs) && err.retryAfterMs >= 0
          ? err.retryAfterMs
          : RATE_LIMIT_DEFAULT_WAIT_MS;
        waitMs = Math.min(Math.max(requestedMs, RATE_LIMIT_DEFAULT_WAIT_MS), RATE_LIMIT_MAX_WAIT_MS);
        waitReason = `429 (Retry-After ${requestedMs} ms, waiting ${waitMs} ms capped)`;
      } else {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        waitMs = delay * (0.5 + Math.random() * 0.5); // 50-100% of delay
        waitReason = err.status || err.code || 'network';
      }

      const tag = label || 'retry';
      const snippet = (err.message || '').replace(/\s+/g, ' ').slice(0, 200);
      console.warn(`[${tag}] Attempt ${attempt + 1}/${maxRetries + 1} failed (${waitReason}): ${snippet} — retrying in ${Math.round(waitMs)}ms...`);
      await _sleep(waitMs);
    }
  }

  throw lastError;
}

/**
 * Wraps a fetch-based API client function to add retry logic.
 * Usage: const resilientFetch = withRetriedFetch(deelFetch, { label: 'Deel' });
 */
export function withRetriedFetch(fetchFn, opts = {}) {
  return (endpoint, fetchOpts) =>
    withRetry(() => fetchFn(endpoint, fetchOpts), { label: opts.label || 'API', ...opts });
}
