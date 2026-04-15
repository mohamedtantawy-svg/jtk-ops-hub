// ── Retry with exponential backoff ──────────────────────────────────────────
// Shared utility used by all API clients (Deel, Zendesk, Jira).
// Retries on network errors and 5xx server errors. Does NOT retry 4xx (those
// are genuine client errors — wrong params, auth failures, etc.).

const DEFAULTS = {
  maxRetries: 3,
  baseDelay: 800,   // ms — first retry after ~800ms
  maxDelay: 8000,   // ms — cap at 8s
  retryOn5xx: true,  // retry on 500/502/503/504
};

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

      // Don't retry 4xx errors (bad request, unauthorized, not found, etc.)
      if (err.status && err.status >= 400 && err.status < 500) {
        throw err;
      }

      // Don't retry if we've exhausted attempts
      if (attempt >= maxRetries) {
        break;
      }

      // Only retry 5xx if configured
      if (err.status && err.status >= 500 && !retryOn5xx) {
        throw err;
      }

      // Exponential backoff with jitter
      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      const jitter = delay * (0.5 + Math.random() * 0.5); // 50-100% of delay
      const tag = label || 'retry';
      console.warn(`[${tag}] Attempt ${attempt + 1}/${maxRetries + 1} failed (${err.status || err.code || 'network'}), retrying in ${Math.round(jitter)}ms...`);
      await new Promise(r => setTimeout(r, jitter));
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
