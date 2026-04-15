// ── Persistent server-side cache ────────────────────────────────────────────
// File-backed JSON cache that survives container restarts and deployments.
// Falls back to in-memory if filesystem is read-only.
//
// Why: in-memory caches (`let cache = null`) reset on every deploy/restart,
// causing the first user to wait 10-30s while all external APIs are re-fetched.
// This cache writes to /tmp (writable on Vercel, Docker, etc.) so the data
// is available instantly after restart.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const CACHE_DIR = join(process.env.CACHE_DIR || '/tmp', 'ops-hub-cache');
const memoryFallback = new Map(); // in-memory fallback if FS fails

// Ensure cache directory exists
try {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
} catch {}

/**
 * Read a cached value. Returns null if expired or missing.
 * @param {string} key — cache key (becomes filename)
 * @param {number} ttl — max age in ms
 */
export function cacheGet(key, ttl) {
  // Try filesystem first
  try {
    const filePath = join(CACHE_DIR, `${key}.json`);
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, 'utf-8');
      const { data, ts } = JSON.parse(raw);
      if (ts && Date.now() - ts < ttl) return data;
    }
  } catch {}

  // Fallback to in-memory
  const mem = memoryFallback.get(key);
  if (mem && Date.now() - mem.ts < ttl) return mem.data;

  return null;
}

/**
 * Write a value to cache (both file and memory).
 * @param {string} key — cache key
 * @param {any} data — JSON-serializable data
 */
export function cacheSet(key, data) {
  const ts = Date.now();

  // Always update memory
  memoryFallback.set(key, { data, ts });

  // Try to persist to filesystem (non-blocking failure)
  try {
    const filePath = join(CACHE_DIR, `${key}.json`);
    writeFileSync(filePath, JSON.stringify({ data, ts }), 'utf-8');
  } catch (err) {
    // Filesystem write failed — memory cache still works
    console.warn(`[server-cache] Failed to write ${key}:`, err.message);
  }
}

/**
 * Check if a cache entry exists and is fresh.
 */
export function cacheHas(key, ttl) {
  return cacheGet(key, ttl) !== null;
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
