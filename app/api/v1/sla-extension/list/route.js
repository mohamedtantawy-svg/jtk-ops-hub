// ── GET /api/v1/sla-extension/list ────────────────────────────────────────
// Returns every currently-active SLA extension (one row per
// (task_source, task_id) where revoked_at IS NULL and expires_at > NOW()).
// Read-only — no per-user scoping because the extension list is global
// metadata: the FE looks up extensions by (source, id) for every visible
// row, and the user only ever sees rows they're already scoped to via the
// normal queue scoping.
//
// 30s server cache mirrors the hide-task list pattern — keeps the cost
// negligible even with many queue mounts per second across the team.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { query } from '../../../../../src/lib/db';
import { cacheGet, cacheSet } from '../../../../../src/lib/server-cache';
import { slaExtensionKey } from '../../../../../src/lib/sla-extension-helpers';

const CACHE_KEY = 'sla_extension_list';
const CACHE_TTL = 30_000;

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cached = cacheGet(CACHE_KEY, CACHE_TTL);
  if (cached) return NextResponse.json(cached);

  // 2026-05-22 — Madeleine Solares Decuir reported the SLA Extension
  // button "keeps appearing" on offboarding rows after an extension was
  // already requested, so the same task gets re-submitted repeatedly.
  // The server already 409s on duplicates (see hr-hub/requests/route.js
  // `sla_extension_request` branch — checks both active extensions and
  // in-review hr_hub_request rows), but the FE row gives no signal that
  // a request is already in flight. Surface BOTH sets here so the row
  // can render a badge + disable the action button until the existing
  // extension expires / drops below 12h or the pending request is
  // resolved.
  const [activeRes, pendingRes] = await Promise.all([
    query(
      `SELECT id, task_source, task_id, task_url, task_subject,
              request_id, reason_code,
              requested_by_email, requested_by_name,
              approved_by_email, approved_by_name,
              approved_days, effective_from, expires_at
         FROM sla_extension
        WHERE revoked_at IS NULL
          AND expires_at > NOW()
        ORDER BY expires_at ASC
        LIMIT 5000`,
    ),
    // Pending = an `sla_extension_request` hr_hub_request that's still in
    // an actionable status. Resolved/Rejected fall out automatically.
    query(
      `SELECT id, task_source, task_id, task_url, task_subject,
              sla_ext_requested_days, sla_ext_reason_code,
              requester_email, requester_name,
              status, created_at, updated_at
         FROM hr_hub_request
        WHERE flow = 'sla_extension_request'
          AND status IN ('new', 'in_progress', 'on_hold')
          AND task_source IS NOT NULL
          AND task_id IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 5000`,
    ).catch(err => {
      // Defensive: if the table or column lookup fails on a brand-new
      // env, fall back to no pending data rather than 500-ing the whole
      // list — the FE still functions, it just can't gray the button
      // for in-review requests on that env until the migration runs.
      console.warn('[sla-extension/list pending] fallback:', err.message);
      return { rows: [] };
    }),
  ]);

  const items = activeRes.rows.map(r => ({
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
    key: slaExtensionKey(r.task_source, r.task_id),
  }));

  const pending = pendingRes.rows.map(r => ({
    id: r.id,
    taskSource: r.task_source,
    taskId: r.task_id,
    taskUrl: r.task_url,
    taskSubject: r.task_subject,
    requestedDays: r.sla_ext_requested_days,
    reasonCode: r.sla_ext_reason_code,
    requestedByEmail: r.requester_email,
    requestedByName: r.requester_name,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    key: slaExtensionKey(r.task_source, r.task_id),
  }));

  const payload = { items, total: items.length, pending, pendingTotal: pending.length };
  cacheSet(CACHE_KEY, payload);
  return NextResponse.json(payload);
}
