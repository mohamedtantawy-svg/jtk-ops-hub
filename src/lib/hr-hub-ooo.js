// ── HR Hub OOO cover (2026-05-22; backup-first 2026-06-04) ──────────────────
// When a new HR Hub request resolves to an assignee who's currently out of
// office, the row is re-routed so it doesn't sit unworked. The original
// assignee is stamped in `cover_for_assignee_email` so the lazy reconciler
// can flip the row back the moment they return.
//
// Who does it re-route to?
// ────────────────────────
// 1. The BACKUP who accepted the OOO person's handover coverage (Mohamed
//    2026-06-04: "when a manager is OOO, the HR Hub tasks should be assigned
//    to their backup who accepted the handover, not to their manager"). The
//    coverer explicitly agreed to step into this person's seat for the
//    window, so their work goes there — NOT up the management chain. When
//    several coverers exist, the all-scope backup wins (an empty country
//    list = covers everything); the most-recent handover breaks ties.
// 2. FALLBACK — only if there's no accepted backup (or the backup is itself
//    OOO): walk up to the first non-OOO manager (Jose Ruales' original spec —
//    the manager owns the same scope + is already accountable for the queue).
// 3. If the whole manager chain is also OOO, leave the row on the original
//    assignee (no cover stamp); the reconciler / unassigned-pool owners
//    handle it.
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
 * Find the accepted handover BACKUP currently covering `email` (the person
 * who is OOO). Returns the coverer who explicitly accepted to cover this
 * person for a window that includes today, or null if there is none.
 *
 * When the OOO person has multiple accepted coverers (e.g. country-scoped
 * splits), the all-scope coverer wins — an empty / null country list means
 * "covers everything", which is the right target for a generic HR Hub
 * request. array_length(empty, 1) is NULL in Postgres, so COALESCE(...,0)
 * sorts the all-scope backup first; the most-recent handover breaks ties.
 *
 * Returns null on lookup failure so a transient DB blip just falls through
 * to the manager-chain fallback rather than mis-routing.
 */
async function findActiveCovererFor(email) {
  if (!email) return null;
  try {
    const { rows } = await query(
      `SELECT hc.coverer_email,
              COALESCE(array_length(hc.country_codes, 1), 0) AS scope_size
         FROM handover_coverers hc
         JOIN handovers h ON h.id = hc.handover_id
        WHERE LOWER(h.requester_email) = LOWER($1)
          AND hc.acceptance_status = 'accepted'
          AND h.status IN ('approved','active')
          AND h.start_date <= CURRENT_DATE
          AND h.end_date   >= CURRENT_DATE
        ORDER BY scope_size ASC, h.start_date DESC
        LIMIT 1`,
      [email],
    );
    if (rows.length === 0) return null;
    const cEmail = String(rows[0].coverer_email || '').toLowerCase();
    if (!cEmail) return null;
    return { email: cEmail, name: memberByEmail(cEmail)?.name || null };
  } catch (err) {
    console.warn('[hr-hub-ooo] findActiveCovererFor lookup failed:', err.message);
    return null;
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
  // Prefer the accepted handover BACKUP (Mohamed 2026-06-04): the coverer
  // who explicitly accepted to cover this person has stepped into their seat,
  // so route their work there rather than up the management chain. Skip a
  // backup who is themselves OOO — that just moves the problem.
  const backup = await findActiveCovererFor(lcEmail);
  if (backup && backup.email && backup.email !== lcEmail && !(await isCurrentlyOoo(backup.email))) {
    return {
      assigneeEmail: backup.email,
      assigneeName: backup.name,
      coverForEmail: lcEmail,
      coverForName: proposedName || memberByEmail(lcEmail)?.name || null,
      redirected: true,
    };
  }

  // No accepted backup (or the backup is also OOO) — fall back to the first
  // non-OOO manager (Jose Ruales' original spec).
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
            AND status IN ('new', 'in_progress', 'on_hold', 'pending_requester')
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
