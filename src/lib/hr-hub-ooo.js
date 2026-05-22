// ── HR Hub OOO cover (2026-05-22) ──────────────────────────────────────────
// When a new HR Hub request resolves to an assignee who's currently out of
// office, the row is re-routed to the next non-OOO ancestor in the manager
// chain. The original assignee is stamped in `cover_for_assignee_email`
// so the lazy reconciler can flip the row back the moment they return.
//
// Why the manager (and not the TLOC, a country owner, etc.)?
// ──────────────────────────────────────────────────────────
// Jose Ruales spec: "it should be reassigned to their manager if they are
// OOO." Manager owns the same scope of work + already accountable for the
// agent's queue. Falls back to TL → admin pool only if the entire chain
// is OOO (rare).
//
// Why a lazy reconciler instead of a cron?
// ────────────────────────────────────────
// Two reasons:
//   1. No new infrastructure — every list-endpoint hit fans through the
//      reconciler, throttled at module level so we run at most once a
//      minute regardless of how many requests come in.
//   2. The next "interesting" moment in a request's life is when someone
//      OPENS the queue / list — exactly when the freshness matters. A
//      cron-driven flip with no observer can land seconds before the
//      user looks anyway.
//
// HR Hub is global — every dept follows the same rule (Jose's spec).
// No dept-scoped branching here.

import { query } from './db';
import { memberByEmail, managerEmailFor } from './hr-hub-helpers';

// Maximum hops up the manager chain when looking for a non-OOO ancestor.
// 4 covers the deepest known org branch (Agent → TL → RM → Director → Admin)
// without risk of infinite loops on malformed manager data.
const MAX_MANAGER_HOPS = 4;

// Lazy-reconciler throttle. The list endpoint can fire dozens of times a
// minute on a busy team; we only need the reconciler to run "every so
// often" to keep covers honest.
const RECONCILER_MIN_INTERVAL_MS = 60_000;
let _lastReconcileAt = 0;
let _inFlightReconcile = null;

/**
 * True when `email` has an active approved time-off event covering "now"
 * (start_date <= today <= end_date). All-day grain — matches the time-off
 * events FE behaviour. Case-insensitive email match.
 *
 * Returns false on lookup failure so a transient DB blip during create
 * doesn't accidentally redirect the request — the worst case is the row
 * lands with its original assignee and the reconciler catches it on the
 * next pass.
 */
export async function isCurrentlyOoo(email) {
  if (!email) return false;
  try {
    const { rows } = await query(
      `SELECT 1
         FROM time_off_events
        WHERE LOWER(work_email) = LOWER($1)
          AND status = 'approved'
          AND start_date <= CURRENT_DATE
          AND end_date   >= CURRENT_DATE
        LIMIT 1`,
      [email],
    );
    return rows.length > 0;
  } catch (err) {
    console.warn('[hr-hub-ooo] isCurrentlyOoo lookup failed:', err.message);
    return false;
  }
}

/**
 * Walk the manager chain from `email` upward, returning the first ancestor
 * who is NOT currently OOO. Returns null if every ancestor is OOO (rare —
 * the row falls back to the original assignee in that case, with no
 * cover stamp).
 */
async function findFirstNonOooManager(email) {
  let cursor = String(email || '').toLowerCase();
  const seen = new Set();
  for (let i = 0; i < MAX_MANAGER_HOPS; i++) {
    const mgr = managerEmailFor(cursor);
    if (!mgr || seen.has(mgr)) return null;
    seen.add(mgr);
    if (!(await isCurrentlyOoo(mgr))) {
      return { email: mgr, name: memberByEmail(mgr)?.name || null };
    }
    cursor = mgr;
  }
  return null;
}

/**
 * Resolve the effective assignee for a new (or freshly-reassigned) HR Hub
 * request. If the proposed assignee is currently OOO, walk the manager
 * chain for the first non-OOO ancestor.
 *
 * Returns: {
 *   assigneeEmail,     // the email the row should actually be assigned to
 *   assigneeName,      // matching display name
 *   coverForEmail,     // the ORIGINAL email (null when no redirect happened)
 *   coverForName,      // original's display name (null when no redirect)
 *   redirected,        // true when we re-routed away from the proposed
 * }
 *
 * If the proposed assignee is null/falsy, returns the input unchanged
 * (the request lands in the unassigned pool — same behaviour as before).
 *
 * If the proposed assignee IS OOO but every ancestor is also OOO, the
 * row stays with the proposed assignee (no cover stamped) — we don't
 * route to a dead-end manager.
 */
export async function resolveAssigneeWithOooCover(proposedEmail, proposedName) {
  if (!proposedEmail) {
    return {
      assigneeEmail: null,
      assigneeName: null,
      coverForEmail: null,
      coverForName: null,
      redirected: false,
    };
  }
  const lcEmail = String(proposedEmail).toLowerCase();
  const ooo = await isCurrentlyOoo(lcEmail);
  if (!ooo) {
    return {
      assigneeEmail: lcEmail,
      assigneeName: proposedName || memberByEmail(lcEmail)?.name || null,
      coverForEmail: null,
      coverForName: null,
      redirected: false,
    };
  }
  const cover = await findFirstNonOooManager(lcEmail);
  if (!cover) {
    // Every manager in the chain is also OOO — leave the row on the
    // original assignee with no cover stamp. The reconciler will pick
    // them up when they return; in the meantime the unassigned pool
    // owners (HR Hub admins) can step in via the existing escalation
    // flow.
    return {
      assigneeEmail: lcEmail,
      assigneeName: proposedName || memberByEmail(lcEmail)?.name || null,
      coverForEmail: null,
      coverForName: null,
      redirected: false,
    };
  }
  return {
    assigneeEmail: cover.email,
    assigneeName: cover.name,
    coverForEmail: lcEmail,
    coverForName: proposedName || memberByEmail(lcEmail)?.name || null,
    redirected: true,
  };
}

/**
 * Flip every request whose `cover_for_assignee_email` points at a person
 * who is NO LONGER OOO. Restores the original assignee + clears the
 * cover stamp. Writes a hr_hub_log entry per row so the audit trail
 * shows the auto-reassign.
 *
 * Throttled at the module level: at most one run per
 * RECONCILER_MIN_INTERVAL_MS regardless of how many callers fire. A
 * single in-flight Promise is shared across concurrent callers so we
 * never double-fire. The throttle is a soft floor, not a guarantee —
 * if you need stronger guarantees, schedule a cron.
 *
 * Returns: { ran, flipped } — ran=false means the throttle window
 * suppressed this call (no work done), flipped is the number of rows
 * reassigned back to their original owners on the most-recent actual
 * run.
 */
export async function reconcileOooCovers({ force = false } = {}) {
  if (_inFlightReconcile) return _inFlightReconcile;
  const now = Date.now();
  if (!force && (now - _lastReconcileAt) < RECONCILER_MIN_INTERVAL_MS) {
    return { ran: false, flipped: 0 };
  }
  _lastReconcileAt = now;
  _inFlightReconcile = (async () => {
    try {
      // Pull every covered row. Bound to 500 per pass — well above any
      // realistic backlog and small enough that the per-row OOO query
      // chain doesn't snowball on a single tick.
      const { rows } = await query(
        `SELECT id, assignee_email, assignee_name,
                cover_for_assignee_email, cover_for_assignee_name
           FROM hr_hub_request
          WHERE cover_for_assignee_email IS NOT NULL
            AND status IN ('new', 'in_progress', 'on_hold')
          ORDER BY updated_at ASC
          LIMIT 500`,
      );
      let flipped = 0;
      for (const r of rows) {
        const originalEmail = r.cover_for_assignee_email;
        if (!originalEmail) continue;
        if (await isCurrentlyOoo(originalEmail)) continue;
        // Original is back — flip the row.
        const restoreName = r.cover_for_assignee_name
          || memberByEmail(originalEmail)?.name
          || null;
        await query(
          `UPDATE hr_hub_request
              SET assignee_email = $2,
                  assignee_name  = $3,
                  cover_for_assignee_email = NULL,
                  cover_for_assignee_name  = NULL,
                  updated_at = NOW()
            WHERE id = $1`,
          [r.id, originalEmail, restoreName],
        );
        // Audit log — keeps the request history honest. The "actor" is
        // null because no human did this; downstream readers can render
        // a "System" label when actor_email IS NULL.
        try {
          await query(
            `INSERT INTO hr_hub_log
                 (request_id, actor_email, actor_name, event_type, before_json, after_json)
             VALUES ($1, NULL, 'System', 'auto_cover_released', $2::jsonb, $3::jsonb)`,
            [
              r.id,
              JSON.stringify({ assigneeEmail: r.assignee_email }),
              JSON.stringify({ assigneeEmail: originalEmail, coverReleased: true }),
            ],
          );
        } catch (err) {
          console.warn('[hr-hub-ooo] log write failed:', err.message);
        }
        flipped++;
      }
      return { ran: true, flipped };
    } catch (err) {
      console.warn('[hr-hub-ooo] reconcile failed:', err.message);
      return { ran: true, flipped: 0 };
    } finally {
      _inFlightReconcile = null;
    }
  })();
  return _inFlightReconcile;
}
