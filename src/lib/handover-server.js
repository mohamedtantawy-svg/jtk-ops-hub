// ── Handover server-side helpers ───────────────────────────────────────
// Pulled out of route files so every API endpoint applies the same
// state-machine, role checks, log writes, and notification enqueues. No
// React or fetch imports — server only.
//
// Most helpers accept an optional `client` (a pg client from
// withTransaction). When omitted they fall back to the shared pool
// `query()` so callers that don't need transactional atomicity stay
// terse.

import { query, withTransaction } from './db';
import {
  HANDOVER_STATUSES,
  IN_FLIGHT_STATUSES,
  HANDOVER_EVENT_TYPES,
  HANDOVER_NOTIFICATION_TYPES,
} from './handover-helpers';

// ── State machine — allowed transitions ────────────────────────────────
// Maps each status to the set of statuses it can move to. The lifecycle
// cron is the only writer of active / completed / expired; we still
// include those edges here so the cron uses the same helper.
const ALLOWED_TRANSITIONS = Object.freeze({
  [HANDOVER_STATUSES.DRAFT]: new Set([
    HANDOVER_STATUSES.PENDING_COVERAGE_ACCEPTANCE,
    HANDOVER_STATUSES.CANCELLED,
  ]),
  [HANDOVER_STATUSES.PENDING_COVERAGE_ACCEPTANCE]: new Set([
    HANDOVER_STATUSES.PENDING_MANAGER_APPROVAL,
    HANDOVER_STATUSES.APPROVED,
    HANDOVER_STATUSES.CANCELLED,
  ]),
  [HANDOVER_STATUSES.PENDING_MANAGER_APPROVAL]: new Set([
    HANDOVER_STATUSES.APPROVED,
    HANDOVER_STATUSES.REJECTED,
    HANDOVER_STATUSES.CANCELLED,
  ]),
  [HANDOVER_STATUSES.APPROVED]: new Set([
    HANDOVER_STATUSES.ACTIVE,
    HANDOVER_STATUSES.CANCELLED,
    HANDOVER_STATUSES.EXPIRED,
  ]),
  [HANDOVER_STATUSES.ACTIVE]: new Set([
    HANDOVER_STATUSES.COMPLETED,
    HANDOVER_STATUSES.CANCELLED,
    HANDOVER_STATUSES.EXPIRED,
  ]),
  [HANDOVER_STATUSES.COMPLETED]: new Set(),
  [HANDOVER_STATUSES.REJECTED]: new Set(),
  [HANDOVER_STATUSES.CANCELLED]: new Set(),
  [HANDOVER_STATUSES.EXPIRED]: new Set(),
});

export function isTransitionAllowed(from, to) {
  const set = ALLOWED_TRANSITIONS[from];
  return !!set && set.has(to);
}

export class HandoverStateError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.name = 'HandoverStateError';
    this.status = status;
  }
}

export class HandoverAuthError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.name = 'HandoverAuthError';
    this.status = status;
  }
}

// ── Loaders ────────────────────────────────────────────────────────────

const HANDOVER_BASE_FIELDS = `
  h.id, h.requester_email, h.start_date, h.end_date, h.time_off_event_id, h.reason,
  h.status, h.manager_email, h.manager_approval_required,
  h.manager_decision_at, h.manager_decision_note,
  h.checklist_template_id, h.settings_id,
  h.submitted_at, h.activated_at, h.completed_at,
  h.cancelled_at, h.cancelled_by, h.cancel_reason,
  h.created_at, h.updated_at
`;

const _q = (client) => (sql, params) => (client ? client.query(sql, params) : query(sql, params));

async function loadCoverers(handoverId, client) {
  const { rows } = await _q(client)(
    `SELECT id, coverer_email, country_codes, acceptance_status,
            accepted_at, declined_at, decline_reason, invited_at
       FROM handover_coverers
      WHERE handover_id = $1
      ORDER BY invited_at ASC`,
    [handoverId],
  );
  return rows;
}

async function loadChecklistItems(handoverId, client) {
  const { rows } = await _q(client)(
    `SELECT id, item_id, label, required, completed, note, completed_at, completed_by
       FROM handover_checklist_items
      WHERE handover_id = $1
      ORDER BY required DESC, label ASC`,
    [handoverId],
  );
  return rows;
}

async function loadLog(handoverId, client) {
  const { rows } = await _q(client)(
    `SELECT id, event_type, actor_email, actor_name, detail, created_at
       FROM handover_log
      WHERE handover_id = $1
      ORDER BY created_at DESC, id DESC`,
    [handoverId],
  );
  return rows;
}

/**
 * Load a single handover hydrated with coverers + checklist + log.
 * Throws a 404 if not found.
 */
export async function loadHandoverWithDetails(id, { client } = {}) {
  const { rows } = await _q(client)(
    `SELECT ${HANDOVER_BASE_FIELDS} FROM handovers h WHERE h.id = $1`,
    [id],
  );
  const h = rows[0];
  if (!h) {
    const err = new Error('Handover not found');
    err.status = 404;
    throw err;
  }
  const [coverers, checklistItems, log] = await Promise.all([
    loadCoverers(id, client),
    loadChecklistItems(id, client),
    loadLog(id, client),
  ]);
  return { ...h, coverers, checklist_items: checklistItems, log };
}

// ── Role checks ────────────────────────────────────────────────────────

function lc(v) { return (v || '').toLowerCase(); }

export function isAdminOrRm(user) {
  const role = user?.role;
  return role === 'admin' || role === 'regional_manager';
}

export function canModifyHandover(user, handover) {
  if (!user?.email) return false;
  if (isAdminOrRm(user)) return true;
  return lc(handover?.requester_email) === lc(user.email);
}

export function canApproveHandover(user, handover) {
  if (!user?.email) return false;
  if (isAdminOrRm(user)) return true;
  return lc(handover?.manager_email) === lc(user.email);
}

export function canCancelHandover(user, handover) {
  if (!user?.email) return false;
  if (isAdminOrRm(user)) return true;
  if (lc(handover?.requester_email) === lc(user.email)) return true;
  return lc(handover?.manager_email) === lc(user.email);
}

// Coverer rows are validated by direct membership lookup; this helper
// returns the matched coverer row or null so the caller can both
// authorize AND update the same row.
export async function findCovererRow(handoverId, covererEmail, client) {
  const { rows } = await _q(client)(
    `SELECT id, coverer_email, country_codes, acceptance_status
       FROM handover_coverers
      WHERE handover_id = $1 AND LOWER(coverer_email) = $2
      LIMIT 1`,
    [handoverId, lc(covererEmail)],
  );
  return rows[0] || null;
}

// ── Status transition writer ───────────────────────────────────────────

/**
 * Move a handover from `current.status` to `next` atomically with a
 * matching `handover_log` row. Caller must already hold a transaction
 * (`client`) so an outer rollback wins on failure. Returns the updated
 * handover row.
 */
export async function transitionStatus(client, handover, next, {
  actor, logEventType, logDetail, extraColumns,
}) {
  if (!isTransitionAllowed(handover.status, next)) {
    throw new HandoverStateError(
      `Transition not allowed: ${handover.status} → ${next}`,
    );
  }

  // Build the SET clause dynamically so callers can stamp the timing
  // columns appropriate to the transition (submitted_at, activated_at,
  // completed_at, cancelled_at) without an explicit UPDATE for each.
  const setParts = ['status = $2', 'updated_at = NOW()'];
  const params = [handover.id, next];
  let p = 3;
  for (const [col, val] of Object.entries(extraColumns || {})) {
    setParts.push(`${col} = $${p++}`);
    params.push(val);
  }
  const updateSql = `
    UPDATE handovers
       SET ${setParts.join(', ')}
     WHERE id = $1
     RETURNING ${HANDOVER_BASE_FIELDS.replace(/h\./g, '')}
  `;
  const updated = await client.query(updateSql, params);

  await writeLog(client, handover.id, logEventType, actor, logDetail || {});

  return updated.rows[0];
}

// ── Audit log writer ───────────────────────────────────────────────────

export async function writeLog(client, handoverId, eventType, actor, detail = {}) {
  await _q(client)(
    `INSERT INTO handover_log (handover_id, event_type, actor_email, actor_name, detail)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [handoverId, eventType, lc(actor?.email) || null, actor?.name || null, JSON.stringify(detail)],
  );
}

// ── Notification writer ───────────────────────────────────────────────
// Goes through the existing user_notifications table so the bell icon
// + the full /notifications page pick handover events up alongside
// existing mention notifications. link_view='ooo' + link_id=handoverId
// is the routing contract the FE consumes.

export async function notifyUser(client, recipientEmail, type, handoverId, {
  title, body, actor, sourceType = 'handover', sourceId = null,
} = {}) {
  if (!recipientEmail) return;
  await _q(client)(
    `INSERT INTO user_notifications
       (recipient_email, type, title, body, link_view, link_id,
        source_type, source_id, actor_email, actor_name)
     VALUES ($1, $2, $3, $4, 'ooo', $5, $6, $7, $8, $9)`,
    [
      lc(recipientEmail),
      type,
      title || '',
      body || '',
      String(handoverId || ''),
      sourceType,
      String(sourceId || handoverId || ''),
      lc(actor?.email) || null,
      actor?.name || null,
    ],
  );
}

// Fan-out helper: dispatch a notification to many recipients in one go.
// Duplicates are deduped by lowercase email so a coverer who's also the
// manager doesn't get two copies of the same alert.
export async function notifyMany(client, recipients, type, handoverId, payload) {
  const uniq = new Set();
  for (const r of recipients || []) {
    if (!r) continue;
    uniq.add(lc(r));
  }
  for (const r of uniq) {
    await notifyUser(client, r, type, handoverId, payload);
  }
}

// ── Status recompute after coverer accept / decline ────────────────────
// After every coverer mutation, if the handover sits in
// PENDING_COVERAGE_ACCEPTANCE and ALL coverers are now accepted, advance
// to either PENDING_MANAGER_APPROVAL (when settings require approval) or
// straight to APPROVED. Returns the new status or the original when no
// transition fires.

export async function recomputeAfterCovererChange(client, handover, actor) {
  if (handover.status !== HANDOVER_STATUSES.PENDING_COVERAGE_ACCEPTANCE) {
    return handover;
  }
  const { rows } = await client.query(
    `SELECT acceptance_status FROM handover_coverers WHERE handover_id = $1`,
    [handover.id],
  );
  if (rows.length === 0) return handover;
  const anyPending = rows.some(r => r.acceptance_status === 'pending');
  const anyDeclined = rows.some(r => r.acceptance_status === 'declined');
  if (anyPending || anyDeclined) return handover;

  // All accepted — advance.
  const requiresApproval = handover.manager_approval_required !== false;
  const next = requiresApproval
    ? HANDOVER_STATUSES.PENDING_MANAGER_APPROVAL
    : HANDOVER_STATUSES.APPROVED;
  const updated = await transitionStatus(client, handover, next, {
    actor,
    logEventType: requiresApproval
      ? HANDOVER_EVENT_TYPES.SUBMITTED   // re-stamped: the manager needs to review
      : HANDOVER_EVENT_TYPES.MANAGER_APPROVED,
    logDetail: { reason: 'all_coverers_accepted' },
  });

  // Fan-out notifications for the new status.
  if (requiresApproval && updated.manager_email) {
    await notifyUser(client, updated.manager_email, HANDOVER_NOTIFICATION_TYPES.PENDING_APPROVAL, updated.id, {
      title: 'Handover awaiting your approval',
      body: `${updated.requester_email} → cover ${formatRange(updated.start_date, updated.end_date)}`,
      actor,
    });
  } else {
    const coverers = await loadCoverers(updated.id, client);
    await notifyMany(client, [
      updated.requester_email,
      ...coverers.map(c => c.coverer_email),
    ], HANDOVER_NOTIFICATION_TYPES.APPROVED, updated.id, {
      title: 'Handover approved (no manager approval required)',
      body: `Covers ${formatRange(updated.start_date, updated.end_date)}`,
      actor,
    });
  }

  return updated;
}

// ── Helpers shared with handlers ───────────────────────────────────────

function formatRange(startIso, endIso) {
  if (!startIso || !endIso) return '';
  return startIso === endIso ? String(startIso) : `${startIso} → ${endIso}`;
}

export { formatRange };

// ── Default-settings resolver ─────────────────────────────────────────
// The wizard / create endpoint needs to know which `handover_settings`
// row drives a new handover. We resolve in scope order: team > region >
// global, picking the most specific match. For Phase 2 we use the
// global default since per-region/team rows arrive in Phase 5.

export async function resolveDefaultSettings({ team, region } = {}, client) {
  const q = _q(client);
  // Team scope wins
  if (team) {
    const r = await q(
      `SELECT id, default_template_id, manager_approval_required,
              coverer_acceptance_required, allow_country_split, min_days_to_trigger
         FROM handover_settings
        WHERE scope = 'team' AND scope_value = $1
        LIMIT 1`,
      [team],
    );
    if (r.rows[0]) return r.rows[0];
  }
  if (region) {
    const r = await q(
      `SELECT id, default_template_id, manager_approval_required,
              coverer_acceptance_required, allow_country_split, min_days_to_trigger
         FROM handover_settings
        WHERE scope = 'region' AND scope_value = $1
        LIMIT 1`,
      [region],
    );
    if (r.rows[0]) return r.rows[0];
  }
  const g = await q(
    `SELECT id, default_template_id, manager_approval_required,
            coverer_acceptance_required, allow_country_split, min_days_to_trigger
       FROM handover_settings
      WHERE scope = 'global' AND is_default = true
      LIMIT 1`,
  );
  return g.rows[0] || null;
}

export async function loadTemplate(id, client) {
  if (!id) return null;
  const q = _q(client);
  const r = await q(
    `SELECT id, name, items FROM handover_checklist_templates WHERE id = $1`,
    [id],
  );
  return r.rows[0] || null;
}

// Convenience: a one-shot wrapper that opens a transaction, executes,
// and returns whatever the callback resolves. Mirrors withTransaction in
// db.js but exists here so routes don't import db.js directly.

export { withTransaction };
