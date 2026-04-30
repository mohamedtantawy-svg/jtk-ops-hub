// ── Persistent server-side cache ────────────────────────────────────────────
// File-backed JSON cache that survives container restarts and deployments.
// Falls back to in-memory if filesystem is read-only.
//
// Why: in-memory caches (`let cache = null`) reset on every deploy/restart,
// causing the first user to wait 10-30s while all external APIs are re-fetched.
// This cache writes to /tmp (writable on Vercel, Docker, etc.) so the data
// is available instantly after restart.
//
// Memory safety: LRU eviction keeps max MAX_ENTRIES in memory. A periodic
// sweep runs every CLEANUP_INTERVAL ms to remove expired entries.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const CACHE_DIR = join(process.env.CACHE_DIR || '/tmp', 'ops-hub-cache');
const MAX_ENTRIES = 30;           // LRU cap — at most 30 entries in memory
const CLEANUP_INTERVAL = 5 * 60_000; // sweep stale entries every 5 minutes
const MAX_FILE_AGE = 60 * 60_000;    // remove cache files older than 60 minutes

const memoryFallback = new Map(); // in-memory fallback if FS fails
const accessOrder = [];           // LRU tracking: most-recently-used at end

// Ensure cache directory exists
try {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
} catch {}

// ── LRU helpers ─────────────────────────────────────────────────────────────
function touchLRU(key) {
  const idx = accessOrder.indexOf(key);
  if (idx !== -1) accessOrder.splice(idx, 1);
  accessOrder.push(key);
}

function evictIfNeeded() {
  while (memoryFallback.size > MAX_ENTRIES && accessOrder.length > 0) {
    const oldest = accessOrder.shift();
    memoryFallback.delete(oldest);
  }
}

// ── Periodic cleanup of stale entries (both memory + filesystem) ────────────
function cleanupStaleEntries() {
  // Memory: remove entries older than MAX_FILE_AGE
  const now = Date.now();
  for (const [key, entry] of memoryFallback.entries()) {
    if (now - entry.ts > MAX_FILE_AGE) {
      memoryFallback.delete(key);
      const idx = accessOrder.indexOf(key);
      if (idx !== -1) accessOrder.splice(idx, 1);
    }
  }

  // Filesystem: remove stale cache files
  try {
    const files = readdirSync(CACHE_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const filePath = join(CACHE_DIR, file);
        const st = statSync(filePath);
        if (now - st.mtimeMs > MAX_FILE_AGE) {
          unlinkSync(filePath);
        }
      } catch {}
    }
  } catch {}
}

// Run cleanup every 5 minutes
const _cleanupTimer = setInterval(cleanupStaleEntries, CLEANUP_INTERVAL);
if (_cleanupTimer.unref) _cleanupTimer.unref(); // Don't block Node.js shutdown

/**
 * Read a cached value. Returns null if expired or missing.
 * @param {string} key — cache key (becomes filename)
 * @param {number} ttl — max age in ms
 */
export function cacheGet(key, ttl) {
  // Try memory first (fast path — no I/O)
  const mem = memoryFallback.get(key);
  if (mem && Date.now() - mem.ts < ttl) {
    touchLRU(key);
    return mem.data;
  }

  // Fallback to filesystem (sync for backward compat in staleWhileRevalidate)
  try {
    const filePath = join(CACHE_DIR, `${key}.json`);
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, 'utf-8');
      const { data, ts } = JSON.parse(raw);
      if (ts && Date.now() - ts < ttl) {
        // Populate memory cache for fast subsequent reads
        memoryFallback.set(key, { data, ts });
        touchLRU(key);
        evictIfNeeded();
        return data;
      }
    }
  } catch {}

  return null;
}

/**
 * Write a value to cache (both file and memory).
 * Enforces LRU max size to prevent unbounded memory growth.
 * @param {string} key — cache key
 * @param {any} data — JSON-serializable data
 */
export function cacheSet(key, data) {
  const ts = Date.now();

  // Update memory with LRU tracking
  memoryFallback.set(key, { data, ts });
  touchLRU(key);
  evictIfNeeded();

  // Persist to filesystem asynchronously (non-blocking)
  const filePath = join(CACHE_DIR, `${key}.json`);
  writeFile(filePath, JSON.stringify({ data, ts }), 'utf-8').catch(err => {
    // Use printf-style format with %s so CodeQL doesn't flag `key` as an
    // externally-controlled format string (cwe-134 in `js/tainted-format-
    // string`). Functionally identical to the previous template literal.
    console.warn('[server-cache] Failed to write %s:', key, err.message);
  });
}

/**
 * Check if a cache entry exists and is fresh.
 */
export function cacheHas(key, ttl) {
  return cacheGet(key, ttl) !== null;
}

/**
 * Delete a cache entry (memory + filesystem).
 * Used after writes to invalidate stale cache before the next read.
 * @param {string} key — cache key
 */
export function cacheDel(key) {
  memoryFallback.delete(key);
  const idx = accessOrder.indexOf(key);
  if (idx !== -1) accessOrder.splice(idx, 1);
  try {
    const filePath = join(CACHE_DIR, `${key}.json`);
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {
    // FS read-only or permission error — memory delete still succeeded
  }
}

/**
 * Delete multiple cache entries at once. Convenient for invalidating all
 * related caches (e.g., ['queue', 'queue_zendesk', 'queue_jira']) after a write.
 */
export function cacheDelMany(keys) {
  for (const k of keys) cacheDel(k);
}

/**
 * Stale-while-revalidate pattern:
 * Returns cached data immediately (even if stale), then calls revalidate().
 * If no cache at all, awaits revalidate() and caches the result.
 *
 * @param {string} key — cache key
 * @param {number} ttl — fresh TTL in ms
 * @param {number} staleTtl — stale-but-usable TTL in ms (e.g., 10 * ttl)
 * @param {Function} revalidate — async function that returns fresh data
 * @returns {{ data, isStale, revalidating }}
 */
export async function staleWhileRevalidate(key, ttl, staleTtl, revalidate) {
  const fresh = cacheGet(key, ttl);
  if (fresh) return { data: fresh, isStale: false, revalidating: false };

  const stale = cacheGet(key, staleTtl);
  if (stale) {
    // Return stale data immediately, refresh in background
    revalidate().then(data => { if (data) cacheSet(key, data); }).catch(() => {});
    return { data: stale, isStale: true, revalidating: true };
  }

  // No cache at all — must await
  const data = await revalidate();
  if (data) cacheSet(key, data);
  return { data, isStale: false, revalidating: false };
}
