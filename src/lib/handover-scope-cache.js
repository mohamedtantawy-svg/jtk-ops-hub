// ── Handover scope cache (client-safe state holder) ───────────────────
// Phase 3 of HANDOVERS_PLAN.md. Module-level Map<email, delegations[]>
// consumed by the sync queue-scoping getters so an active handover
// coverer transparently picks up the OOO person's queues.
//
// Why this file is client-safe: queue-scoping.js is imported on BOTH
// sides of the wire (every Queue.jsx render, every Briefing aggregate,
// every API route that scopes data). If this module pulled `pg` via
// db.js the client bundle would explode at build time.
//
// The actual DB loader lives in handover-scope-cache-loader.js (server-
// only). At runtime it imports `_setCache` from here and writes the
// shared Map. The sync getter reads it. ES module singletons keep both
// sides talking to the same state.
//
// On the client the loader is never imported, so the cache stays empty
// — and `getActiveHandoverDelegationsSync` returns `[]` everywhere. The
// client never needs the delegation data; the FE consumes the already-
// scoped API responses.

let cache = new Map();
let cacheLoadedAt = 0;

// Returns a defensively-empty copy so a caller can iterate freely.
// Callers MUST treat the returned array as read-only.
export function getActiveHandoverDelegationsSync(email) {
  if (!email) return [];
  const list = cache.get(String(email).toLowerCase());
  if (!list || list.length === 0) return [];
  return list;
}

// All delegations across all coverers. Useful for boot-time logging /
// debug dashboards. Never called from the request path.
export function listAllActiveDelegationsSync() {
  const out = [];
  for (const [coverer, list] of cache.entries()) {
    for (const d of list) out.push({ coverer, ...d });
  }
  return out;
}

export function getHandoverScopeCacheAge() {
  return cacheLoadedAt === 0 ? null : Date.now() - cacheLoadedAt;
}

// Internal setters used by the server-only loader. Underscored to mark
// them as not part of the public surface. The loader is the only legit
// caller; if anything else writes here, the cache will get out of sync
// and the merge will mis-fire.
export function _setCacheState(nextMap, loadedAt) {
  cache = nextMap instanceof Map ? nextMap : new Map();
  cacheLoadedAt = typeof loadedAt === 'number' ? loadedAt : Date.now();
}

export function _getCacheState() {
  return { cache, cacheLoadedAt };
}
