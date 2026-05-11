// ── Handover scope cache loader (server-only) ──────────────────────────
// Lives separately from handover-scope-cache.js so the client bundle
// never sees `pg` via db.js. queue-scoping.js imports the client-safe
// reader; instrumentation.js + handover-server.js import this loader.
//
// Responsibilities:
//   • Loading the delegation map from Postgres
//   • Eager hydration on boot + 60-second refresh interval
//   • Fire-and-forget invalidation after every handover write
//
// On the wire: every active or approved-in-window handover with at
// least one accepted coverer becomes one entry per coverer in the map.

import { query } from './db';
import { _setCacheState } from './handover-scope-cache';

const TTL_MS = 60_000;
const VERBOSE = process.env.NODE_ENV !== 'production';

let pendingReload = null;
let _interval = null;

async function _loadFromDb() {
  const rows = (await query(
    `SELECT hc.coverer_email,
            h.id           AS handover_id,
            h.requester_email,
            h.start_date,
            h.end_date,
            hc.country_codes
       FROM handover_coverers hc
       JOIN handovers h ON h.id = hc.handover_id
      WHERE hc.acceptance_status = 'accepted'
        AND h.status IN ('approved','active')
        AND h.start_date <= CURRENT_DATE
        AND h.end_date   >= CURRENT_DATE`,
  )).rows;

  const next = new Map();
  for (const r of rows) {
    const k = String(r.coverer_email || '').toLowerCase();
    if (!k) continue;
    const start = r.start_date instanceof Date ? r.start_date.toISOString().slice(0, 10) : r.start_date;
    const end   = r.end_date   instanceof Date ? r.end_date.toISOString().slice(0, 10)   : r.end_date;
    const countries = new Set(
      (Array.isArray(r.country_codes) ? r.country_codes : [])
        .map(c => String(c || '').toUpperCase())
        .filter(Boolean),
    );
    if (!next.has(k)) next.set(k, []);
    next.get(k).push({
      handoverId: r.handover_id,
      requesterEmail: String(r.requester_email || '').toLowerCase(),
      countries,
      startDate: start,
      endDate: end,
    });
  }
  _setCacheState(next, Date.now());
  if (VERBOSE && next.size > 0) {
    console.log(`[handover-scope-cache] loaded ${rows.length} delegation row(s) for ${next.size} coverer(s)`);
  }
  return next;
}

export async function ensureHandoverScopeCacheFresh() {
  // We don't read the loaded-at from the client-safe module here because
  // the TTL is enforced by the refresh interval below. Callers who want
  // a fresh read can call invalidateAndReloadHandoverScopeCache().
  if (pendingReload) return pendingReload;
  pendingReload = _loadFromDb().finally(() => { pendingReload = null; });
  return pendingReload;
}

/**
 * Force-reload from the DB. Called from every handover write handler.
 * Fire-and-forget — failures here cannot break the response.
 */
export async function invalidateAndReloadHandoverScopeCache() {
  try {
    return await ensureHandoverScopeCacheFresh();
  } catch (err) {
    console.warn('[handover-scope-cache] reload failed:', err?.message);
  }
}

export function startHandoverScopeCacheRefresher() {
  if (_interval) return;
  ensureHandoverScopeCacheFresh().catch(err => {
    console.warn('[handover-scope-cache] initial load failed:', err?.message);
  });
  _interval = setInterval(() => {
    invalidateAndReloadHandoverScopeCache();
  }, TTL_MS);
  if (typeof _interval?.unref === 'function') _interval.unref();
}

export function stopHandoverScopeCacheRefresher() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}
