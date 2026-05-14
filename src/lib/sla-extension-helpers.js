// ── SLA Extension — server-side helpers ────────────────────────────────
// Companion module to the SLA Extensions feature
// (SLA_EXTENSIONS_PLAN.md). Mirrors hide-task-helpers.js — small,
// side-effect-explicit utilities, no business logic in the route handlers
// themselves.
//
// Phase 1 (request side): exposes the allowed source / reason enums plus
// the canonical (task_source, task_id) key shape. Phase 2 will add the
// approve handler and Phase 3 the active-extension lookup used by every
// queue route to enrich rows.

import { query } from './db.js';

// Allowed source keys — same eight surfaces as Hide Task minus
// `urgent_assist` (urgent-assist has its own off-cycle workflow), plus
// the ticket sources Zendesk and Jira. Centralised so the row action
// only renders for known sources and the server validates strictly.
export const ALLOWED_TASK_SOURCES = new Set([
  'zendesk', 'jira', 'workbench',
  'onboarding', 'offboarding',
  'amendments', 'redlines',
  'incentive_plans',
]);

// Three reason codes from the user-facing spec. The team-member picks one
// at submit; the same value flows through to the approved
// `sla_extension.reason_code` column.
export const ALLOWED_REASON_CODES = new Set([
  'immigration',
  'client_unresponsive',
  'employee_unresponsive',
]);

// Team-member-pickable durations on the request form. The manager can
// choose any value in 1..7 on approval, so this set only governs what
// the request form lets through.
export const ALLOWED_REQUESTED_DAYS = new Set([3, 5, 7]);

// Manager-approval cap. Server-side validation only — UI uses the same
// range as a slider.
export const APPROVED_DAYS_MIN = 1;
export const APPROVED_DAYS_MAX = 7;

// Canonical key for `(task_source, task_id)`. Returned to the FE so a
// queue-row's `slaExtension` field can be looked up by the same string
// the server uses internally.
export function slaExtensionKey(taskSource, taskId) {
  if (!taskSource || !taskId) return null;
  return `${taskSource}:${taskId}`;
}

// Look up the currently-active extension (if any) for a (source, id)
// pair. Active = not revoked AND not expired. Returns null when no
// extension is active. Used by Phase 3's row-enrichment path; exported
// now so unit tests + the request-side duplicate check can share one
// implementation.
export async function findActiveExtension(taskSource, taskId, client = null) {
  if (!taskSource || !taskId) return null;
  const runner = client || { query };
  const { rows } = await runner.query(
    `SELECT id, task_source, task_id, task_url, task_subject,
            request_id, reason_code,
            requested_by_email, requested_by_name,
            approved_by_email, approved_by_name,
            approved_days,
            effective_from, expires_at, revoked_at
       FROM sla_extension
      WHERE task_source = $1
        AND task_id     = $2
        AND revoked_at IS NULL
        AND expires_at > NOW()
      LIMIT 1`,
    [taskSource, taskId],
  );
  return rows[0] ? _shapeExtensionRow(rows[0]) : null;
}

// Bulk lookup used by Phase 3's queue enrichment — one query for many
// `(source, id)` pairs keeps the per-fetch cost flat regardless of how
// many rows the user has visible. Returns a Map keyed on
// `slaExtensionKey(source, id)` so callers can splice the extension
// onto each row in O(1).
export async function findActiveExtensionsByKeys(pairs, client = null) {
  if (!Array.isArray(pairs) || pairs.length === 0) return new Map();
  const sources = [];
  const ids = [];
  for (const p of pairs) {
    if (!p || !p.taskSource || !p.taskId) continue;
    sources.push(p.taskSource);
    ids.push(String(p.taskId));
  }
  if (sources.length === 0) return new Map();
  const runner = client || { query };
  // unnest($1, $2) zips the two arrays into a virtual table the JOIN can
  // filter against — one round-trip, no SQL injection surface (params are
  // string arrays, not interpolated).
  const { rows } = await runner.query(
    `SELECT s.*
       FROM sla_extension s
       JOIN unnest($1::text[], $2::text[]) AS k(task_source, task_id)
         ON s.task_source = k.task_source AND s.task_id = k.task_id
      WHERE s.revoked_at IS NULL
        AND s.expires_at > NOW()`,
    [sources, ids],
  );
  const map = new Map();
  for (const r of rows) {
    map.set(slaExtensionKey(r.task_source, r.task_id), _shapeExtensionRow(r));
  }
  return map;
}

// Insert an approved extension. Called by Phase 2's approve handler.
// ON CONFLICT DO NOTHING keeps the enclosing txn alive (skill mistake
// caught in hide-task — a raised-then-caught 23505 poisons the txn so
// subsequent writeLog calls fail with 25P02).
export async function insertSlaExtension({
  taskSource, taskId, taskUrl, taskSubject,
  requestId,
  reasonCode,
  requestedByEmail, requestedByName,
  approvedByEmail, approvedByName,
  approvedDays,
}, client = null) {
  const runner = client || { query };
  if (!Number.isInteger(approvedDays) || approvedDays < APPROVED_DAYS_MIN || approvedDays > APPROVED_DAYS_MAX) {
    throw new Error(`approvedDays must be an integer in [${APPROVED_DAYS_MIN}, ${APPROVED_DAYS_MAX}]`);
  }
  const { rows } = await runner.query(
    `INSERT INTO sla_extension
       (task_source, task_id, task_url, task_subject,
        request_id,
        reason_code,
        requested_by_email, requested_by_name,
        approved_by_email,  approved_by_name,
        approved_days,
        effective_from, expires_at)
     VALUES ($1, $2, $3, $4,
             $5,
             $6,
             $7, $8,
             $9, $10,
             $11,
             NOW(), NOW() + ($11 || ' days')::interval)
     ON CONFLICT (task_source, task_id) WHERE revoked_at IS NULL AND expires_at > NOW()
       DO NOTHING
     RETURNING *`,
    [
      taskSource, taskId, taskUrl || null, taskSubject || null,
      requestId || null,
      reasonCode,
      requestedByEmail, requestedByName || null,
      approvedByEmail,  approvedByName  || null,
      approvedDays,
    ],
  );
  return rows[0] ? _shapeExtensionRow(rows[0]) : null;
}

function _shapeExtensionRow(r) {
  return {
    id: r.id,
    taskSource: r.task_source,
    taskId: r.task_id,
    taskUrl: r.task_url,
    taskSubject: r.task_subject,
    requestId: r.request_id,
    reasonCode: r.reason_code,
    requestedByEmail: r.requested_by_email,
    requestedByName: r.requested_by_name,
    approvedByEmail: r.approved_by_email,
    approvedByName: r.approved_by_name,
    approvedDays: r.approved_days,
    effectiveFrom: r.effective_from,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    key: slaExtensionKey(r.task_source, r.task_id),
  };
}
