// ── Scan-timeout helper for queue routes ───────────────────────────────────
// Every queue route that fans out to a paginated upstream scan (Deel admin
// terminations_v3, redlines, incentive plans, etc.) needs an overall
// ceiling so a slow upstream page can't keep the request alive for
// minutes — that's the exact symptom that triggered the 2026-05-01
// performance overhaul. This helper wraps a builder function in a hard
// timer; if it fires before the scan resolves, we abandon the in-flight
// scan and return whatever's in the stale cache (or surface a clean
// error if there's nothing cached).
//
// The scan keeps running on the server (we don't have a way to cancel
// upstream HTTP cleanly mid-cursor-walk), so on timeout we both:
//   • Resolve the user-visible request with stale cache, and
//   • Let the scan complete in the background and refresh the cache for
//     subsequent calls. This means the second user to hit the route gets
//     fresh data immediately even if the first user's wait timed out.

import { cacheGet, cacheSet } from './server-cache';

// In-flight dedupe map, keyed by cacheKey. When two requests miss cache
// at the same moment, the second one piggybacks on the first request's
// builder Promise instead of spawning a parallel scan. Without this,
// every concurrent miss spawned its own ~5,000-row Deel admin walk —
// 4 concurrent users could pile 4 scans worth of memory on the heap
// before any of them finished, which was the dominant cause of the
// hourly OOM-restart pattern (2026-05-04 incident).
//
// Cleared automatically when the underlying Promise settles (success or
// failure), so a stuck-forever scan can't poison the slot indefinitely.
const _inFlight = new Map();

// ── Global scan concurrency semaphore ─────────────────────────────────────
// 2026-05-19 (CRASH_AUDIT phase 2): the in-flight dedupe above only stops
// duplicate work for the SAME cacheKey. Different scan types — offboarding
// + onboarding + workbench + redlines + incentive-plans + amendments —
// each have their own cacheKey, so 6 different routes can each run their
// own ~50-page Deel admin walk concurrently. Each walk retains its row
// array + raw response buffers in heap until the merge completes; live
// logs at 09:23 UTC showed 3 concurrent scans pushing RSS from 2019 →
// 2329 MiB in under 2 minutes, with the kernel OOM-killing the pod
// shortly after.
//
// MAX_CONCURRENT_SCANS is a HARD cap on how many builder() functions can
// be executing at the same time across ALL cacheKeys. The 4th builder
// waits in the queue until a slot frees up; if it can't acquire one
// before the outer timeoutMs expires, the existing stale-cache fallback
// path serves the response. Routes already tolerate stale data on
// timeout (`Live build exceeded ... — serving stale cache` lines), so
// the queued-wait fallback is a no-op behaviour change.
//
// Default: 2. Tunable via MAX_CONCURRENT_SCANS env var for diagnostic
// purposes. Two is empirically sufficient for ~5 concurrent users
// average (the typical Ops Hub load). Three would let three different
// admin scans pile up — that's the climb shape we want to prevent.
const MAX_CONCURRENT_SCANS = (() => {
  const env = Number(process.env.MAX_CONCURRENT_SCANS);
  return Number.isFinite(env) && env > 0 ? Math.floor(env) : 2;
})();

let _activeScans = 0;
const _waiters = [];

function _acquireScanSlot() {
  if (_activeScans < MAX_CONCURRENT_SCANS) {
    _activeScans++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    _waiters.push(resolve);
  });
}

function _releaseScanSlot() {
  const next = _waiters.shift();
  if (next) {
    // Hand the slot directly to the next waiter — _activeScans stays at
    // its current value (which is === MAX_CONCURRENT_SCANS, so this just
    // transfers ownership).
    next();
  } else {
    _activeScans--;
  }
}

/** Diagnostic export — current semaphore state. Used by /api/v1/diagnostics. */
export function getScanSemaphoreState() {
  return {
    active: _activeScans,
    queued: _waiters.length,
    max: MAX_CONCURRENT_SCANS,
  };
}

/**
 * Run `builder()` with a `timeoutMs` ceiling. On timeout, return the
 * stale cache value (or surface the timeout as a structured error if
 * nothing is cached). Successful builds populate the cache.
 *
 * @param {string}   cacheKey       — cache key for both fresh + stale reads
 * @param {Function} builder        — async () => result
 * @param {Object}   opts
 * @param {number}   opts.timeoutMs — hard ceiling on the build (default 45s)
 * @param {number}   opts.staleTtl  — stale window the route accepts (default 60min)
 * @returns {Promise<{ result, stale, timedOut }>}
 *   result   — the cached/computed payload (may be `null` on cold-cache timeout)
 *   stale    — true when the result came from the stale cache
 *   timedOut — true when the live build hit the ceiling (regardless of stale fallback)
 */
export async function buildWithTimeout(cacheKey, builder, opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : 45_000;
  const staleTtl = Number.isFinite(opts.staleTtl) && opts.staleTtl > 0 ? opts.staleTtl : 60 * 60_000;

  // Dedupe: if a build for this cacheKey is already running, reuse it.
  // Otherwise spawn a new builder, gated behind the global semaphore so
  // at most MAX_CONCURRENT_SCANS distinct builders run at once. Concurrent
  // callers with the SAME cacheKey still piggyback on a single flight
  // (and share its slot) — only NEW builders queue for slots.
  let buildPromise = _inFlight.get(cacheKey);
  if (!buildPromise) {
    buildPromise = (async () => {
      await _acquireScanSlot();
      try {
        const result = await builder();
        cacheSet(cacheKey, result);
        return result;
      } finally {
        _releaseScanSlot();
      }
    })();
    _inFlight.set(cacheKey, buildPromise);
    // Always clear the slot when the Promise settles so a stuck/failed
    // build can't keep callers piggybacking on a dead Promise forever.
    buildPromise.finally(() => {
      if (_inFlight.get(cacheKey) === buildPromise) _inFlight.delete(cacheKey);
    });
  }

  let timedOut = false;

  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => { timedOut = true; resolve('__TIMEOUT__'); }, timeoutMs);
  });

  const winner = await Promise.race([buildPromise, timeoutPromise]);

  if (winner !== '__TIMEOUT__') {
    return { result: winner, stale: false, timedOut: false };
  }

  // Timed out — fall back to stale cache.
  const stale = cacheGet(cacheKey, staleTtl);
  // Let the in-flight build keep running so the cache eventually refreshes,
  // but don't block the response on it. Swallow late errors so they don't
  // unhandled-reject.
  buildPromise.catch(err => {
    // printf-style format so CodeQL doesn't flag `cacheKey` as an
    // externally-controlled format string (cwe-134).
    console.warn('[scan-timeout] Late build error after %dms timeout for %s:', timeoutMs, cacheKey, err.message);
  });

  if (stale) {
    return { result: stale, stale: true, timedOut: true };
  }

  return { result: null, stale: false, timedOut: true };
}
