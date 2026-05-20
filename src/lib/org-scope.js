// ── org-scope (Phase 6, 2026-05-20) ────────────────────────────────────────
// Server-side helpers that resolve "which members live under a given
// org subtree?" for queue + briefing scoping. Phase 6 wires this in
// alongside the legacy `team` filter so the rest of the app continues
// reading both shapes during the transition window. Phase 7 cleanup
// retires the legacy filter once every downstream consumer is migrated.
//
// All helpers are pure-function: caller supplies the rows (typically
// cached upstream) so this module stays trivially testable without
// dragging the db connection in.

/**
 * Return the set of node ids in the subtree rooted at `rootId` (inclusive).
 * @param {string} rootId
 * @param {Map<string, Object>} childrenByParent — built from
 *   `tree.byParent` in useOrgNodes / shared helper.
 * @returns {Set<string>}
 */
export function subtreeNodeIds(rootId, childrenByParent) {
  const out = new Set();
  if (!rootId) return out;
  const stack = [rootId];
  let safety = 0;
  while (stack.length && safety < 5000) {
    const id = stack.pop();
    if (out.has(id)) continue;
    out.add(id);
    const kids = childrenByParent.get(id) || [];
    for (const k of kids) stack.push(k.id);
    safety += 1;
  }
  return out;
}

/**
 * Filter a member list to those whose org_node_id lives anywhere under
 * `rootId`. Members with a null orgNodeId are excluded unless the caller
 * passes { includeUnassigned: true } (used by the "Unassigned" bucket).
 */
export function membersInSubtree(members, rootId, childrenByParent, { includeUnassigned = false } = {}) {
  const allowed = subtreeNodeIds(rootId, childrenByParent);
  return (members || []).filter(m => {
    if (!m.orgNodeId) return includeUnassigned;
    return allowed.has(m.orgNodeId);
  });
}

/**
 * For a given user, return the org node they "own" for scoping purposes.
 * Admins + regional managers own the entire tree (caller-side: returns null
 * so the consumer treats it as "no scope filter"). Team leads own their
 * own node + descendants. Agents own only themselves (returned as null so
 * the consumer falls back to email-scoped queries — the existing pattern).
 *
 * @returns {string|null} node id, or null when the caller should not
 *                        apply an org-tree filter at all.
 */
export function userOrgScope(user, members) {
  if (!user?.email) return null;
  if (user.role === 'admin' || user.role === 'regional_manager') return null;
  const lc = user.email.toLowerCase();
  const me = (members || []).find(m => (m.email || '').toLowerCase() === lc);
  if (!me?.orgNodeId) return null;
  // Team leads scope to their own subtree; agents fall back to email
  // scoping by returning null (the consumer treats null as "filter by
  // own email" — matches the pre-Phase-6 behaviour).
  if (user.role === 'team_lead') return me.orgNodeId;
  return null;
}
