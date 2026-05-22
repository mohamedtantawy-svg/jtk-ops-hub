// ── applySlaExtensions ──────────────────────────────────────────────────
// Phase 3 of SLA_EXTENSIONS_PLAN.md. The override point that wires an
// approved sla_extension into every downstream SLA consumer in one
// place: the row's `slaRemaining`, `slaBreachStatus`, and `slaWindowMs`
// are rewritten so the existing pill / tier / count math reads the
// extended timer naturally — Queue pills, SourceTable pill, BriefingView
// org-breach ring, Team SLA dot, and Analytics KPI all benefit without
// per-consumer code changes.
//
// Contract for the override (each row gets):
//   • slaExtension       = the matched extension row (read by slaTier /
//                          slaInfo for the "Extended" badge copy)
//   • slaRemaining       = (expiresAt - now) / 1000     // seconds
//   • slaBreachStatus    = 'SLA_NOT_BREACHED'           // hides red pills
//                                                       // (canonical value
//                                                       //  used by every
//                                                       //  consumer that
//                                                       //  filters on
//                                                       //  'SLA_BREACHED')
//   • slaWindowMs        = approvedDays × 24h           // proportional band
//
// Once `expiresAt` passes, the row never matches the lookup again and
// reverts to its normalised SLA state (almost certainly red, since the
// extension is requested precisely because the original SLA was about
// to / already breached).

const DAY_MS = 24 * 60 * 60 * 1000;
// 2026-05-22 — Madeleine's ask: a new SLA Extension can only be requested
// when the existing one is within 12h of breaching. Until that threshold,
// the row's action button is disabled and a visible badge surfaces the
// active extension so the requester doesn't keep re-clicking the action.
const EXTENSION_LOCKOUT_WINDOW_MS = 12 * 60 * 60 * 1000;
export { EXTENSION_LOCKOUT_WINDOW_MS };

// Human-readable display metadata for the 8 queue sources accepted by
// SLA Extension / Hide Task requests. Centralised so the request card,
// detail panel, and approve modal all label the source consistently.
// Keep in sync with ALLOWED_TASK_SOURCES in src/lib/sla-extension-helpers.js.
export const TASK_SOURCE_DISPLAY = {
  zendesk:         { label: 'Zendesk',         icon: 'bi-headset',           color: '#15803d', bg: '#f0fdf4' },
  jira:            { label: 'Jira',            icon: 'bi-kanban-fill',       color: '#1f74b3', bg: '#e0f2fe' },
  workbench:       { label: 'Workbench',       icon: 'bi-tools',             color: '#7c3aed', bg: '#f5f3ff' },
  onboarding:      { label: 'Onboarding',      icon: 'bi-person-check-fill', color: '#15803d', bg: '#f0fdf4' },
  offboarding:     { label: 'Offboarding',     icon: 'bi-box-arrow-right',   color: '#dc2626', bg: '#fef2f2' },
  amendments:      { label: 'Amendments',      icon: 'bi-file-earmark-text', color: '#ea580c', bg: '#fff7ed' },
  redlines:        { label: 'Redlines',        icon: 'bi-pencil-square',     color: '#b91c1c', bg: '#fef2f2' },
  incentive_plans: { label: 'Incentive Plans', icon: 'bi-trophy-fill',       color: '#a16207', bg: '#fffbeb' },
};

/**
 * Apply the active-extension override to a list of normalized rows.
 *
 * @param {Array<object>} rows - rows that already carry .id (string-able)
 * @param {Map<string, object> | null | undefined} extensionMap - keyed on
 *   `${source}:${taskId}` per slaExtensionKey() in
 *   src/lib/sla-extension-helpers.js
 * @param {string} source - canonical source name (e.g. 'onboarding',
 *   'zendesk') used to build the lookup key
 * @param {Map<string, object> | null | undefined} [pendingMap] - keyed
 *   on the same shape. When the row matches a pending entry, it gets
 *   `slaExtensionPending` stamped so the FE can surface "extension
 *   requested" and disable the row's re-request action. Optional;
 *   omitting it preserves previous behaviour.
 * @returns {Array<object>} the rows with the override applied
 */
export function applySlaExtensionsToRows(rows, extensionMap, source, pendingMap) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const hasActiveMap = extensionMap && typeof extensionMap.get === 'function' && extensionMap.size > 0;
  const hasPendingMap = pendingMap && typeof pendingMap.get === 'function' && pendingMap.size > 0;
  if (!hasActiveMap && !hasPendingMap) return rows;
  const now = Date.now();
  return rows.map(r => {
    if (!r || r.id == null) return r;
    const key = `${source}:${String(r.id)}`;
    const ext = hasActiveMap ? extensionMap.get(key) : null;
    const pending = hasPendingMap ? pendingMap.get(key) : null;
    if (!ext && !pending) return r;
    let next = r;
    if (ext && ext.expiresAt) {
      const expiresMs = Date.parse(ext.expiresAt);
      if (Number.isFinite(expiresMs) && expiresMs > now) {
        const remainingMs = expiresMs - now;
        const approvedDays = Number(ext.approvedDays) || 0;
        next = {
          ...next,
          slaExtension: ext,
          slaRemaining: Math.round(remainingMs / 1000),
          slaBreachStatus: 'SLA_NOT_BREACHED',
          slaWindowMs: approvedDays * DAY_MS,
        };
      }
    }
    if (pending) {
      next = { ...next, slaExtensionPending: pending };
    }
    return next;
  });
}

/**
 * Attach the active-extension to a flat `tasks` array (zendesk + jira tickets).
 * Mirrors `applySlaExtensionsToRows` but for the App-level `tasks` state —
 * tickets only carry a `slaExtension` reference (no slaRemaining rewrite
 * needed because `slaInfo()` in helpers.js reads the extension at the top
 * of its decision tree and short-circuits with the "Extended" pill).
 *
 * Returns the SAME array reference when no row matches an active extension,
 * so downstream `useMemo` consumers don't re-render unnecessarily.
 *
 * 2026-05-22 — also stamps `slaExtensionPending` when the optional
 * pendingMap matches, so the queue row can lock the SLA Extension action
 * + show a badge while a request is in review.
 */
export function attachSlaExtensionToTickets(tasks, extensionMap, pendingMap) {
  if (!Array.isArray(tasks) || tasks.length === 0) return tasks;
  const hasActiveMap = extensionMap && typeof extensionMap.get === 'function' && extensionMap.size > 0;
  const hasPendingMap = pendingMap && typeof pendingMap.get === 'function' && pendingMap.size > 0;
  if (!hasActiveMap && !hasPendingMap) return tasks;
  const now = Date.now();
  let mutated = false;
  const out = tasks.map(t => {
    if (!t || !t.source || t.id == null) return t;
    if (t.source !== 'zendesk' && t.source !== 'jira') return t;
    const key = `${t.source}:${String(t.id)}`;
    const ext = hasActiveMap ? extensionMap.get(key) : null;
    const pending = hasPendingMap ? pendingMap.get(key) : null;
    if (!ext && !pending) return t;
    let next = t;
    if (ext && ext.expiresAt) {
      const expiresMs = Date.parse(ext.expiresAt);
      if (Number.isFinite(expiresMs) && expiresMs > now) {
        next = { ...next, slaExtension: ext };
        mutated = true;
      }
    }
    if (pending) {
      next = { ...next, slaExtensionPending: pending };
      mutated = true;
    }
    return next;
  });
  return mutated ? out : tasks;
}

/**
 * Build a Map<key, ext> from the API list shape. Filters expired / revoked
 * rows on the client too so a stale-cache page can't mis-apply an old
 * extension. Returns an empty Map if input is malformed.
 */
export function buildExtensionMap(listItems) {
  const map = new Map();
  if (!Array.isArray(listItems)) return map;
  const now = Date.now();
  for (const e of listItems) {
    if (!e || !e.taskSource || e.taskId == null) continue;
    if (e.revokedAt) continue;
    if (e.expiresAt && Date.parse(e.expiresAt) <= now) continue;
    map.set(`${e.taskSource}:${String(e.taskId)}`, e);
  }
  return map;
}

/**
 * Build a Map<key, pending> from the pending request shape returned by
 * /api/v1/sla-extension/list. Last-write-wins per key — the API already
 * orders by createdAt DESC so the freshest pending request wins.
 */
export function buildPendingExtensionMap(pendingItems) {
  const map = new Map();
  if (!Array.isArray(pendingItems)) return map;
  for (const p of pendingItems) {
    if (!p || !p.taskSource || p.taskId == null) continue;
    const key = `${p.taskSource}:${String(p.taskId)}`;
    if (!map.has(key)) map.set(key, p);
  }
  return map;
}

/**
 * Should the row's "SLA Extension" action be locked? Returns true when:
 *   - An active extension exists with MORE than EXTENSION_LOCKOUT_WINDOW_MS
 *     remaining (the row is comfortably extended; re-requesting now is
 *     wasteful and would be 409'd by the server), OR
 *   - A pending sla_extension_request is in review for this task.
 *
 * Once the active extension has <12h remaining, the lockout lifts so the
 * requester can ask for a fresh extension before the original lapses.
 */
export function isSlaExtensionLocked(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.slaExtensionPending) return true;
  const ext = row.slaExtension;
  if (!ext || !ext.expiresAt) return false;
  const expiresMs = Date.parse(ext.expiresAt);
  if (!Number.isFinite(expiresMs)) return false;
  return (expiresMs - Date.now()) > EXTENSION_LOCKOUT_WINDOW_MS;
}
