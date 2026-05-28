// ── Urgent Assist ⇄ upstream-task auto-resolve reconciler ────────────────
// Oludolapo Akindutire 2026-05-28 feedback ("Urgent assist case not syncing
// properly with resolved issues"): a manual urgent_assist_request row
// (kind='case_monitoring' or plain 'urgent_assist') carries a `link_url`
// pointing the MOC at the upstream task they should watch. When the
// upstream task gets resolved, the urgent assist row stays at its
// initial status — there's no auto-sync today, so the case lingers on
// the active queue and the MOC has to manually click through and mark
// it resolved.
//
// This reconciler closes that gap for **Workbench-linked rows** (the
// most common case_monitoring source per Melissa's spec) by reading the
// warm workbench cache that the canonical workbench route already
// maintains, and UPDATE-ing rows whose upstream task is COMPLETED or
// CLOSED to status='resolved' with an audit log entry. Throttled at the
// module level so it fires at most once per minute regardless of caller
// concurrency — same pattern as `reconcileOooCovers` in hr-hub-ooo.js.
//
// Out of scope for this pass: Zendesk and Jira ticket links. Those
// require pulling from their own caches and are a follow-up if MOC
// reports the same lag on ZD/Jira-linked cases. The Workbench branch
// covers the case_monitoring flow Melissa documented and any manual
// rows that link to a Workbench task.

import { query } from './db';
import { cacheGet } from './server-cache';
import { writeLog } from './urgent-assist-helpers';

// Mirror hr-hub-ooo's throttle: at most one run per minute regardless
// of how many list-GET callers fire. Soft floor; if you need stronger
// guarantees, schedule a cron.
const RECONCILER_MIN_INTERVAL_MS = 60_000;
let _lastReconcileAt = 0;
let _inFlightReconcile = null;

// Same key the canonical workbench route writes to. Reading via cacheGet
// is non-blocking and returns null when the cache is cold — in that
// case the reconciler skips this pass (no fresh upstream data to lean
// on). The next call after the cache warms up will reconcile.
const WORKBENCH_CACHE_KEY = 'deel_workbench';
// 30 min — covers the natural cycle plus a generous stale window. If
// the cache is older than this we treat upstream state as unknown and
// skip rather than acting on stale data.
const WORKBENCH_CACHE_STALE_MS = 30 * 60 * 1000;

// Pull the workbench task id out of an admin URL.
//   https://admin.deel.network/ops-workbench/<id>[?teamIds[]=...]
//   https://admin.deel.network/ops-workbench/<id>/anything
// Returns null when the URL doesn't match the pattern (Zendesk / Jira /
// plain free-text links fall through). The id segment is everything up
// to the first `/`, `?`, or `#` — preserves UUIDs and the legacy
// numeric ids alike.
const WORKBENCH_URL_RE = /admin\.deel(?:\.network|\.com)\/ops-workbench\/([^/?#]+)/i;
export function extractWorkbenchTaskId(linkUrl) {
  if (typeof linkUrl !== 'string' || !linkUrl) return null;
  const m = linkUrl.match(WORKBENCH_URL_RE);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); }
  catch { return m[1]; }
}

// Treat both COMPLETED and CLOSED as terminal — matches the FE mapping
// in useUrgentAssistData.workbenchStatusToTabStatus.
const TERMINAL_UPSTREAM_STATUSES = new Set(['COMPLETED', 'CLOSED']);

/**
 * Scan manual urgent_assist_request rows whose link_url points at a
 * Workbench task and whose status is still active, then UPDATE to
 * 'resolved' for every row whose upstream task is COMPLETED/CLOSED.
 *
 * Throttled at the module level: shared in-flight Promise + min-interval
 * guard. Pass `{ force: true }` from a test or one-shot script to bypass.
 *
 * Returns: { ran, resolved } — ran=false means the throttle window
 * suppressed this call. resolved is the count of rows updated on the
 * most-recent actual run.
 */
export async function reconcileUrgentAssistFromUpstream({ force = false } = {}) {
  if (_inFlightReconcile) return _inFlightReconcile;
  const now = Date.now();
  if (!force && (now - _lastReconcileAt) < RECONCILER_MIN_INTERVAL_MS) {
    return { ran: false, resolved: 0 };
  }
  _lastReconcileAt = now;
  _inFlightReconcile = (async () => {
    try {
      // Read the warm workbench cache. cacheGet returns the cached value
      // when its age is below the supplied TTL, or null otherwise. Don't
      // trigger a fresh fetch from here — the list GET this runs inside
      // must stay fast, and the canonical workbench route owns the
      // refresh cadence.
      const wb = cacheGet(WORKBENCH_CACHE_KEY, WORKBENCH_CACHE_STALE_MS);
      const tasks = Array.isArray(wb?.items) ? wb.items : null;
      if (!tasks || tasks.length === 0) {
        // Cache cold or empty — nothing to reconcile against on this pass.
        return { ran: true, resolved: 0 };
      }
      const byId = new Map();
      for (const t of tasks) {
        if (t && t.id != null) byId.set(String(t.id), t);
      }

      // Pull a bounded set of candidate rows: manual urgent_assist with a
      // link_url and a still-active status. 500 is well above any
      // realistic backlog and small enough that the per-row parse +
      // UPDATE loop doesn't snowball on a single tick.
      const { rows } = await query(
        `SELECT id, link_url, status, assignee_email
           FROM urgent_assist_request
          WHERE link_url IS NOT NULL
            AND status IN ('new', 'in_progress', 'on_hold')
          ORDER BY updated_at ASC
          LIMIT 500`,
      );

      let resolvedCount = 0;
      for (const r of rows) {
        const taskId = extractWorkbenchTaskId(r.link_url);
        if (!taskId) continue;
        const task = byId.get(String(taskId));
        if (!task) continue;
        if (!TERMINAL_UPSTREAM_STATUSES.has(task.status)) continue;

        // Flip the row. Use task.completedAt when available so the
        // resolved_at reads the real upstream timestamp, not "now"
        // (the row was actually resolved earlier — we just noticed now).
        const completedAt = task.completedAt ? new Date(task.completedAt) : null;
        const useCompletedAt = completedAt && !Number.isNaN(completedAt.getTime());
        try {
          await query(
            `UPDATE urgent_assist_request
                SET status      = 'resolved',
                    resolved_at = COALESCE($2::timestamptz, NOW()),
                    updated_at  = NOW()
              WHERE id = $1
                AND status IN ('new', 'in_progress', 'on_hold')`,
            [r.id, useCompletedAt ? completedAt.toISOString() : null],
          );
        } catch (err) {
          console.warn('[urgent-assist-reconciler] UPDATE failed for', r.id, err.message);
          continue;
        }

        // Audit log — actor=System so downstream readers can render
        // "Auto-resolved when Workbench task closed" instead of pinning
        // it on a human. Failures here are non-fatal (don't roll back
        // the UPDATE).
        try {
          await writeLog(
            r.id,
            { email: null, name: 'System' },
            'auto_resolved_from_upstream',
            { status: r.status },
            {
              status: 'resolved',
              source: 'workbench',
              upstreamTaskId: String(taskId),
              upstreamStatus: task.status,
            },
          );
        } catch (err) {
          console.warn('[urgent-assist-reconciler] log write failed for', r.id, err.message);
        }
        resolvedCount++;
      }
      return { ran: true, resolved: resolvedCount };
    } catch (err) {
      console.warn('[urgent-assist-reconciler] reconcile failed:', err.message);
      return { ran: true, resolved: 0 };
    } finally {
      _inFlightReconcile = null;
    }
  })();
  return _inFlightReconcile;
}
