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

  const { rows } = await query(
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
  );

  const items = rows.map(r => ({
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

  const payload = { items, total: items.length };
  cacheSet(CACHE_KEY, payload);
  return NextResponse.json(payload);
}
