// ── Workbench resolution-state reconciliation ───────────────────────────
// DB-backed snapshot + diff model that replaces the per-cycle 5-page
// COMPLETED+CLOSED walk for Workbench tasks. See migrate.js
// (`workbench_known_tasks` table) for the schema and design rationale.
//
// Public surface:
//   reconcileWorkbenchSnapshot({ activeItems, completedItems, statuses, now, lookbackMs })
//     - activeItems:     rows fetched from upstream with active statuses
//     - completedItems:  rows from the cold-start safety net (COMPLETED/CLOSED, last 24h)
//     - statuses:        the set of statuses considered "active" (everything else is terminal)
//     - now:             ms timestamp for this cycle (used for synthesised completedAt)
//     - lookbackMs:      how far back "recently resolved" extends (default 24h)
//   Returns: { resolvedItems, stats }
//     - resolvedItems:   rows resolved within the last `lookbackMs`, sourced from the DB
//                        snapshot. Includes both authoritative (status was COMPLETED in
//                        the safety net) and derived (disappeared from active set) rows.
//                        Each row has `task_data` (slimmed task), `status`, `resolved_at`.
//     - stats:           { observed, derivedAdded, derivedRecovered, pruned, cold }
//
// Concurrency: two pods racing on the same cycle is rare (cache TTL + buildWithTimeout
// coalesce per-pod). When it does happen, the UPSERT/DELETE pairs are race-safe — last
// write wins, both writes are valid snapshots within seconds of each other, derived
// recovery on the next cycle heals any false positives.

import { query } from './db';

const ACTIVE_STATUSES_DEFAULT = ['TO_DO', 'IN_PROGRESS', 'ON_HOLD', 'ESCALATED'];
// If we haven't seen an active task for this long, treat it as "stale" — drop
// from the snapshot entirely. Protects against an unbounded growth in
// `workbench_known_tasks` from upstream rows we lost track of. Set well above
// the poll cadence (3 min) so a single missed cycle doesn't trigger.
const STALE_ACTIVE_MS = 30 * 60_000;

function _completedAtMs(t) {
  const c = t?.completedAt ? Date.parse(t.completedAt) : NaN;
  if (Number.isFinite(c) && c > 0) return c;
  const u = t?.updatedAt ? Date.parse(t.updatedAt) : NaN;
  return Number.isFinite(u) && u > 0 ? u : 0;
}

function _slim(t) {
  // We don't need the full upstream payload in the DB — the slim shape is
  // what the route handler returns to the FE anyway. Mirror the projection
  // in deel-api.js::listWorkbenchTasks so the round-trip is lossless.
  return {
    id: t.id || '',
    name: t.name || '',
    status: t.status || '',
    country: t.country || '',
    assignee: t.assignee ? { id: t.assignee.id, email: t.assignee.email, name: t.assignee.name } : null,
    assigneeEmail: t.assignee?.email || '',
    createdAt: t.createdAt || '',
    updatedAt: t.updatedAt || '',
    completedAt: t.completedAt || null,
    slaBreachStatus: t.slaBreachStatus || '',
    taskType: t.taskConfiguration?.name || '',
    sourceType: t.taskConfiguration?.sourceType || '',
    contractOid: t.contractOid || '',
    // The custom-field array carries country for the row-by-row scan in
    // deel-api.js. Cheaper to retain the few country fields here than to
    // re-walk the slim projection from the route. We trim to country
    // entries to keep JSONB small.
    customFields: Array.isArray(t.taskConfiguration?.customFieldConfigurations)
      ? t.taskConfiguration.customFieldConfigurations
          .filter(f => (f?.reference || '').toUpperCase().includes('COUNTR'))
          .slice(0, 3)
      : undefined,
  };
}

/**
 * Reconcile one Workbench fetch cycle against the persistent snapshot.
 *
 * The flow:
 *   1. UPSERT every observed row into `workbench_known_tasks`. Active rows
 *      clear `resolved_at`; terminal rows set `resolved_at` to the upstream
 *      `completedAt` (or NOW if missing).
 *   2. Find rows still marked active in the DB but NOT seen this cycle for
 *      longer than the active-poll-cadence-x2 — those have disappeared
 *      from upstream's active set. Mark them resolved with `resolved_at = NOW`.
 *      Skipped on the very first call (no prior cycle), so the safety net
 *      is the sole source of resolved on cold start.
 *   3. Prune rows resolved more than `lookbackMs` ago.
 *   4. Prune rows still active but last seen > STALE_ACTIVE_MS ago.
 *   5. Return all rows currently within the resolved-lookback window.
 */
export async function reconcileWorkbenchSnapshot({
  activeItems = [],
  completedItems = [],
  statuses = ACTIVE_STATUSES_DEFAULT,
  now = Date.now(),
  lookbackMs = 24 * 60 * 60_000,
}) {
  const activeStatusSet = new Set(statuses.map(s => String(s).toUpperCase()));
  // Dedupe by task_id before the UPSERT. Upstream cursor pagination can yield
  // the same task on consecutive pages when the row mutates mid-walk, which
  // lands two entries with the same `task_id` in `activeItems`. The Step-1
  // multi-row INSERT then trips Postgres' "ON CONFLICT DO UPDATE command
  // cannot affect row a second time" (verified live 2026-05-15 — 14 misfires
  // in a 4h window). Map.set keeps the LATER observation, mirroring the
  // intended ON CONFLICT semantics; for cross-list collisions the safety-net
  // loop in deel-api.js already excludes anything in `activeItems` via its
  // `seen` set, so practical collisions are within-list only.
  const observedMap = new Map();
  for (const t of activeItems) if (t?.id) observedMap.set(t.id, t);
  for (const t of completedItems) if (t?.id) observedMap.set(t.id, t);
  const observed = Array.from(observedMap.values());

  // Step 0 — figure out if this is a cold-start cycle. If the DB has zero
  // rows we treat this cycle as cold and skip the "disappeared = resolved"
  // sweep. Otherwise a single restart in a fresh environment would mark
  // every prior row as resolved.
  const { rows: countRows } = await query(
    'SELECT COUNT(*)::int AS n FROM workbench_known_tasks',
  );
  const cold = (countRows[0]?.n || 0) === 0;

  // Step 1 — UPSERT everything we observed.
  // Build params in a single multi-row insert; ON CONFLICT updates the
  // last_seen_at + status + resolved_at as appropriate.
  let upserted = 0;
  if (observed.length > 0) {
    // Postgres parameter limit is 65535 — at 5 cols per row that's 13107
    // rows max in one statement. Workbench worst case is ~5700 rows
    // (active + safety net). Comfortably under the cap; no batching needed.
    const cols = ['task_id', 'task_data', 'status', 'last_seen_at', 'resolved_at'];
    const values = [];
    const params = [];
    let i = 1;
    for (const t of observed) {
      if (!t || !t.id) continue;
      const status = String(t.status || '').toUpperCase();
      const slim = _slim(t);
      const isActive = activeStatusSet.has(status);
      const resolvedMs = isActive ? null : (_completedAtMs(t) || now);
      values.push(`($${i++}, $${i++}::jsonb, $${i++}, TO_TIMESTAMP($${i++}::double precision / 1000.0), ${resolvedMs == null ? 'NULL' : `TO_TIMESTAMP($${i++}::double precision / 1000.0)`})`);
      params.push(t.id, JSON.stringify(slim), status, now);
      if (resolvedMs != null) params.push(resolvedMs);
      upserted++;
    }
    if (values.length > 0) {
      await query(
        `INSERT INTO workbench_known_tasks (${cols.join(', ')})
         VALUES ${values.join(', ')}
         ON CONFLICT (task_id) DO UPDATE SET
           task_data    = EXCLUDED.task_data,
           status       = EXCLUDED.status,
           last_seen_at = EXCLUDED.last_seen_at,
           -- Active row: clear any prior resolution (reopened tasks).
           -- Terminal row: set resolved_at to the upstream completedAt.
           -- COALESCE so we don't overwrite an existing real timestamp
           -- with a later same-row observation.
           resolved_at = CASE
             WHEN EXCLUDED.resolved_at IS NULL THEN NULL
             ELSE COALESCE(workbench_known_tasks.resolved_at, EXCLUDED.resolved_at)
           END`,
        params,
      );
    }
  }

  // Step 2 — Derived resolutions. Anything we have in the DB with an
  // active status whose last_seen_at is OLDER than this cycle (i.e. not
  // refreshed by the upsert above) has disappeared from upstream's
  // active set. Mark resolved. Skipped on cold start so we don't
  // synthesise resolutions for the initial backfill — AND skipped when
  // this cycle observed zero active rows: an empty observation usually
  // means upstream hiccuped (not "everyone finished at the same time"),
  // and we don't want to mass-mark every row as resolved on a flake.
  // Real bulk resolutions get picked up in the very next cycle anyway.
  let derivedAdded = 0;
  if (!cold && activeItems.length > 0) {
    const activeArr = Array.from(activeStatusSet);
    const r = await query(
      `UPDATE workbench_known_tasks
          SET status      = 'COMPLETED',
              resolved_at = TO_TIMESTAMP($1::double precision / 1000.0)
        WHERE status = ANY($2::text[])
          AND resolved_at IS NULL
          AND last_seen_at < TO_TIMESTAMP($1::double precision / 1000.0)`,
      [now, activeArr],
    );
    derivedAdded = r.rowCount || 0;
  }

  // Step 3 — recovery: if any row marked resolved was just re-observed
  // active, clear its resolved_at. The Step-1 UPSERT already handles
  // most of this via the CASE expression — the explicit query is here
  // for the edge case where Step 1 ran with an active status (which
  // sets resolved_at = NULL) but the prior row was marked resolved
  // by Step 2 of a prior cycle. The COALESCE in Step 1 prevented
  // clearing because it preserves existing resolved_at. Override:
  // any row whose last_seen_at == NOW and status is active should not
  // be marked resolved. (Already true unless Step 2 of a prior cycle
  // race-fired; safety belt.)
  if (!cold && activeItems.length > 0) {
    const activeArr = Array.from(activeStatusSet);
    await query(
      `UPDATE workbench_known_tasks
          SET resolved_at = NULL
        WHERE status = ANY($1::text[])
          AND resolved_at IS NOT NULL
          AND last_seen_at = TO_TIMESTAMP($2::double precision / 1000.0)`,
      [activeArr, now],
    );
  }

  // Step 4 — prune resolved rows older than the lookback window.
  const pruneR = await query(
    `DELETE FROM workbench_known_tasks
       WHERE resolved_at IS NOT NULL
         AND resolved_at < TO_TIMESTAMP($1::double precision / 1000.0)`,
    [now - lookbackMs],
  );
  const pruned = pruneR.rowCount || 0;

  // Step 5 — prune stale active rows (worker missed a status change).
  await query(
    `DELETE FROM workbench_known_tasks
       WHERE resolved_at IS NULL
         AND last_seen_at < TO_TIMESTAMP($1::double precision / 1000.0)`,
    [now - STALE_ACTIVE_MS],
  );

  // Step 6 — read back the currently-resolved set for return.
  const { rows: resolvedRows } = await query(
    `SELECT task_data, status, EXTRACT(EPOCH FROM resolved_at) * 1000 AS resolved_at_ms
       FROM workbench_known_tasks
      WHERE resolved_at IS NOT NULL
        AND resolved_at > TO_TIMESTAMP($1::double precision / 1000.0)`,
    [now - lookbackMs],
  );

  // Reshape to look like an upstream task so the caller can splice it
  // into allItems without special-casing.
  const resolvedItems = resolvedRows.map(r => {
    const slim = r.task_data || {};
    return {
      ...slim,
      status: r.status,
      completedAt: new Date(Number(r.resolved_at_ms)).toISOString(),
      _resolutionSource: r.status === 'COMPLETED' && !slim.completedAt ? 'derived' : 'upstream',
    };
  });

  return {
    resolvedItems,
    stats: { observed: upserted, derivedAdded, pruned, cold },
  };
}
