// ── Queue source reassignments ──────────────────────────────────────────────
// Centralises read/write for the `queue_reassignments` table. Each Deel
// source route (onboarding / amendments / redlines / incentive plans) calls
// `applyReassignments` on the upstream payload BEFORE scoping so the new
// assignee — and their manager chain — sees the row in their Workspace
// without any change pushed back to Deel.
//
// The cache is short-lived (10 s) so reassignments take effect on the next
// queue poll without forcing every render to query Postgres. `bumpVersion`
// is called on every successful POST so refreshes between the bump and the
// 10-s window read fresh data.

import { query } from './db.js';

const CACHE_TTL_MS = 10 * 1000;
let _cache = null;       // { fetchedAt: number, bySource: Map<source, Map<taskId, override>> }
let _version = 0;

export function bumpVersion() {
  _version += 1;
  _cache = null;
}

async function _loadAll() {
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.bySource;
  }
  try {
    const { rows } = await query(
      `SELECT task_source, task_id, task_url, task_subject, task_country,
              original_assignee_email, original_assignee_name,
              assignee_email, assignee_name,
              reassigned_by_email, reassigned_by_name,
              created_at, updated_at
         FROM queue_reassignments`,
    );
    const bySource = new Map();
    for (const r of rows) {
      const src = String(r.task_source || '').toLowerCase();
      if (!bySource.has(src)) bySource.set(src, new Map());
      bySource.get(src).set(String(r.task_id), {
        taskUrl: r.task_url || null,
        taskSubject: r.task_subject || null,
        taskCountry: r.task_country || null,
        originalAssigneeEmail: r.original_assignee_email || null,
        originalAssigneeName: r.original_assignee_name || null,
        assigneeEmail: (r.assignee_email || '').toLowerCase() || null,
        assigneeName: r.assignee_name || null,
        reassignedByEmail: r.reassigned_by_email || null,
        reassignedByName: r.reassigned_by_name || null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      });
    }
    _cache = { fetchedAt: Date.now(), bySource };
    return bySource;
  } catch (err) {
    // On DB failure return whatever's cached, else an empty map. Better to
    // serve a slightly stale view than 500 the entire queue endpoint.
    if (_cache) return _cache.bySource;
    console.warn('[queue-reassignments] read failed:', err?.message);
    return new Map();
  }
}

// Returns Map<task_id, override> for the given source. The map is shared
// across requests — never mutate it from a route handler.
export async function getReassignmentMap(source) {
  const bySource = await _loadAll();
  return bySource.get(String(source || '').toLowerCase()) || new Map();
}

// Overlay overrides on a list of normalized rows. The row's assigneeEmail /
// assigneeName / assignee fields are replaced; the original values are
// preserved on `originalAssigneeEmail` / `originalAssigneeName` so the UI
// can surface "previously assigned to X" if it ever wants to. Synthetic-
// assignee flags are cleared because the override is a real assignment.
export function applyReassignments(items, overrideMap) {
  if (!Array.isArray(items) || !overrideMap || overrideMap.size === 0) return items;
  return items.map(item => {
    const id = item?.id != null ? String(item.id) : null;
    if (!id) return item;
    const ov = overrideMap.get(id);
    if (!ov || !ov.assigneeEmail) return item;
    return {
      ...item,
      assigneeEmail: ov.assigneeEmail,
      assignee: ov.assigneeName || item.assignee || ov.assigneeEmail,
      assigneeIsSynthetic: false,
      reassignedFromEmail: ov.originalAssigneeEmail || item.assigneeEmail || null,
      reassignedFromName: ov.originalAssigneeName || item.assignee || null,
      reassignedByEmail: ov.reassignedByEmail || null,
      reassignedAt: ov.updatedAt || ov.createdAt || null,
    };
  });
}

// Convenience for routes that want to fetch + apply in one call.
export async function applyReassignmentsForSource(items, source) {
  const map = await getReassignmentMap(source);
  return applyReassignments(items, map);
}

// Allowed source keys — the four queues the user explicitly asked for.
// Workbench / ZD / Jira already have their own upstream-pushing reassign
// endpoints; offboarding wasn't requested.
export const ALLOWED_REASSIGN_SOURCES = new Set([
  'onboarding',
  'amendments',
  'redlines',
  'incentive_plans',
]);

export function isReassignableSource(source) {
  return ALLOWED_REASSIGN_SOURCES.has(String(source || '').toLowerCase());
}
