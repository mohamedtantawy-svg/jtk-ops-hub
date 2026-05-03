// ── Hide Task — server-side helpers ─────────────────────────────────────
// Tiny module shared by /api/v1/hide-task/{list,approve,deny} and the
// HR Hub POST handler when it sees flow='hide_task_request'. Mirrors the
// hr-hub-helpers pattern: small, side-effect-explicit utilities, no
// business logic in the route handlers themselves.

import { query } from './db.js';
import { MEMBERS_BY_EMAIL } from '../data/members.js';

// Allowed source keys for both the FE matcher and the DB column. Centralised
// so the Hide button on every queue can render only when the source maps to
// a known key, and so the approve/deny handlers don't accept junk values.
export const ALLOWED_TASK_SOURCES = new Set([
  'zendesk', 'jira', 'workbench',
  'onboarding', 'paused_onboarding',
  'offboarding',
  'amendments', 'redlines',
  'incentive_plans',
  'urgent_assist',
]);

export const ALLOWED_REASON_CODES = new Set(['internal_deel_employee', 'test_task', 'other']);

/**
 * Resolve a member by email. Lowercased lookup, returns null if missing.
 * Mirrors the helper in hr-hub-helpers.js — kept independent so the two
 * modules don't accidentally share state.
 */
export function memberByEmail(email) {
  if (!email) return null;
  return MEMBERS_BY_EMAIL[String(email).toLowerCase()] || null;
}

/**
 * True when the caller is a system admin OR has team_lead/regional_manager
 * access. Used to gate Approve/Deny actions on a hide request — only the
 * requester's denormalised team_lead_email may approve, with admin override.
 */
export function isManagerOrAdmin(emailLc) {
  const m = MEMBERS_BY_EMAIL[emailLc];
  if (!m) return false;
  const a = (m.access || '').toLowerCase();
  return a === 'admin' || a === 'regional_manager' || a === 'team_lead';
}

/**
 * Build the canonical hide identifier from a request row. Either
 * `${task_source}:${task_id}` (preferred) or `null` when the row is missing
 * one of the two fields. Used as the unique key in hidden_task and as the
 * Set element on the FE.
 */
export function hideKey(taskSource, taskId) {
  if (!taskSource || !taskId) return null;
  return `${taskSource}:${taskId}`;
}

/**
 * Insert into hidden_task (idempotent — UNIQUE active partial index
 * prevents a second insert for the same (task_source, task_id) while the
 * first is still active). Returns the row, or `null` if the unique
 * constraint fired (already hidden — caller treats as success).
 */
export async function insertHiddenTask({
  taskSource, taskId, taskUrl, taskSubject,
  requestId,
  reasonCode, reasonText,
  hiddenByEmail, hiddenByName,
  approvedByEmail, approvedByName,
}, client = null) {
  const runner = client || { query };
  try {
    const { rows } = await runner.query(
      `INSERT INTO hidden_task
         (task_source, task_id, task_url, task_subject,
          request_id,
          reason_code, reason_text,
          hidden_by_email, hidden_by_name,
          approved_by_email, approved_by_name)
       VALUES ($1, $2, $3, $4,
               $5,
               $6, $7,
               $8, $9,
               $10, $11)
       RETURNING *`,
      [
        taskSource, taskId, taskUrl || null, taskSubject || null,
        requestId || null,
        reasonCode, reasonText || null,
        hiddenByEmail, hiddenByName || null,
        approvedByEmail, approvedByName || null,
      ],
    );
    return rows[0] || null;
  } catch (err) {
    // 23505 = unique_violation. Means the task is already hidden — treat
    // as a no-op success (the second approver lost the race).
    if (err?.code === '23505') return null;
    throw err;
  }
}

/**
 * Fetch every active hide entry, projected to the FE row shape. Cached at
 * the API layer for a few seconds to keep this cheap on the Queue boot
 * path even for large lists.
 */
export async function listActiveHidden({ limit = 5000 } = {}) {
  const { rows } = await query(
    `SELECT id, task_source, task_id, task_url, task_subject,
            request_id, reason_code, reason_text,
            hidden_by_email, hidden_by_name,
            approved_by_email, approved_by_name,
            hidden_at
       FROM hidden_task
      WHERE unhidden_at IS NULL
      ORDER BY hidden_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map(r => ({
    id: r.id,
    taskSource: r.task_source,
    taskId: r.task_id,
    taskUrl: r.task_url,
    taskSubject: r.task_subject,
    requestId: r.request_id,
    reasonCode: r.reason_code,
    reasonText: r.reason_text,
    hiddenByEmail: r.hidden_by_email,
    hiddenByName: r.hidden_by_name,
    approvedByEmail: r.approved_by_email,
    approvedByName: r.approved_by_name,
    hiddenAt: r.hidden_at,
    key: hideKey(r.task_source, r.task_id),
  }));
}
