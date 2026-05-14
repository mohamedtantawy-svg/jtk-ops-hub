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

/**
 * Apply the active-extension override to a list of normalized rows.
 *
 * @param {Array<object>} rows - rows that already carry .id (string-able)
 * @param {Map<string, object> | null | undefined} extensionMap - keyed on
 *   `${source}:${taskId}` per slaExtensionKey() in
 *   src/lib/sla-extension-helpers.js
 * @param {string} source - canonical source name (e.g. 'onboarding',
 *   'zendesk') used to build the lookup key
 * @returns {Array<object>} the rows with the override applied
 */
export function applySlaExtensionsToRows(rows, extensionMap, source) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  if (!extensionMap || typeof extensionMap.get !== 'function' || extensionMap.size === 0) return rows;
  const now = Date.now();
  return rows.map(r => {
    if (!r || r.id == null) return r;
    const key = `${source}:${String(r.id)}`;
    const ext = extensionMap.get(key);
    if (!ext || !ext.expiresAt) return r;
    const expiresMs = Date.parse(ext.expiresAt);
    if (!Number.isFinite(expiresMs) || expiresMs <= now) return r;
    const remainingMs = expiresMs - now;
    const approvedDays = Number(ext.approvedDays) || 0;
    return {
      ...r,
      slaExtension: ext,
      slaRemaining: Math.round(remainingMs / 1000),
      slaBreachStatus: 'SLA_NOT_BREACHED',
      slaWindowMs: approvedDays * DAY_MS,
    };
  });
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
