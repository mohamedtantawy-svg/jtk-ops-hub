// ── SLA cascade resolver (Phase 5, 2026-05-20) ─────────────────────────────
// Walks the org tree upward from a node to find the first non-null SLA
// override. Used by queue + briefing scoping in Phase 6; isolated here so
// it stays testable without dragging the full query stack in.
//
// Override shape (stored in org_nodes.config JSONB):
//   { sla: { thresholds: { ticket: 240, onboarding: 1440, ... } } }
//
// Resolution order:
//   1. The node's own override
//   2. Walk parents until one provides an override
//   3. Fall back to global defaults supplied by caller
//
// Implementation note: this is a *pure* helper. Callers pass the resolved
// node graph (id → row) so we don't hit the DB per-resolve; the queue
// hot path resolves once per request and caches.

/**
 * @param {string} nodeId           — id of the node we're resolving SLA for
 * @param {Map<string, Object>} byId — { id → node row } map, must contain ancestors
 * @param {Object} [globalDefaults={}] — fallback when no node provides an override
 * @returns {Object} merged threshold object
 */
export function resolveSlaThresholds(nodeId, byId, globalDefaults = {}) {
  const collected = [];
  let cur = byId.get(nodeId);
  let safety = 0;
  while (cur && safety < 32) {
    const overrides = cur.config?.sla?.thresholds;
    if (overrides && typeof overrides === 'object') collected.push(overrides);
    cur = cur.parentId ? byId.get(cur.parentId) : null;
    safety += 1;
  }
  // Innermost (deepest) wins, then walk outward; merge means later writes
  // overwrite earlier ones, so we apply from outermost → innermost.
  const ordered = collected.reverse();
  let merged = { ...(globalDefaults || {}) };
  for (const o of ordered) merged = { ...merged, ...o };
  return merged;
}

/**
 * Capacity threshold resolver — same shape as SLA, different key. Kept
 * separate so a node can override one without the other.
 */
export function resolveCapacityThresholds(nodeId, byId, globalDefaults = {}) {
  const collected = [];
  let cur = byId.get(nodeId);
  let safety = 0;
  while (cur && safety < 32) {
    const overrides = cur.config?.capacity?.thresholds;
    if (overrides && typeof overrides === 'object') collected.push(overrides);
    cur = cur.parentId ? byId.get(cur.parentId) : null;
    safety += 1;
  }
  const ordered = collected.reverse();
  let merged = { ...(globalDefaults || {}) };
  for (const o of ordered) merged = { ...merged, ...o };
  return merged;
}
