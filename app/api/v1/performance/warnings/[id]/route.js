// ── /api/v1/performance/warnings/[id] ────────────────────────────────────────
// PATCH  — acknowledge (the member) or resolve (manager-of / issuer / perf-admin).
// DELETE — issuer or perf-admin.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { query } from '../../../../../../src/lib/db';
import { canAdministerPerformance } from '../../../../../../src/lib/performance-admin';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import { canScoreMemberPerf } from '../../../../../../src/lib/performance-helpers';

function toClient(w) {
  return {
    id: w.id, orgNodeId: w.org_node_id, memberEmail: w.member_email, memberName: w.member_name,
    level: w.level, reason: w.reason, detail: w.detail, reviewId: w.review_id,
    issuedByEmail: w.issued_by_email, issuedByName: w.issued_by_name, issuedAt: w.issued_at,
    acknowledgedAt: w.acknowledged_at, isResolved: w.is_resolved, resolvedAt: w.resolved_at,
    createdAt: w.created_at, updatedAt: w.updated_at,
  };
}

export async function PATCH(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureRosterHydrated();
  const { id } = await params;
  try {
    const { rows: ex } = await query('SELECT * FROM perf_warnings WHERE id = $1 LIMIT 1', [id]);
    const w = ex[0];
    if (!w) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const me = user.email.toLowerCase();
    const isSelf = w.member_email.toLowerCase() === me;
    const isPerfAdmin = await canAdministerPerformance(user);
    const isManager = canScoreMemberPerf(user, w.member_email, isPerfAdmin);
    const isIssuer = (w.issued_by_email || '').toLowerCase() === me;

    const body = await req.json().catch(() => ({}));
    const sets = []; const values = [];
    if (body.acknowledge === true && (isSelf || isManager)) sets.push('acknowledged_at = COALESCE(acknowledged_at, NOW())');
    if (body.resolve === true && (isManager || isIssuer)) { sets.push('is_resolved = true', 'resolved_at = NOW()'); }
    if (body.resolve === false && (isManager || isIssuer)) { sets.push('is_resolved = false', 'resolved_at = NULL'); }
    if (typeof body.detail === 'string' && (isManager || isIssuer)) { values.push(body.detail.slice(0, 4000)); sets.push(`detail = $${values.length}`); }
    if (sets.length === 0) return NextResponse.json({ error: 'Nothing to update or forbidden' }, { status: 400 });
    sets.push('updated_at = NOW()');
    values.push(id);
    const { rows } = await query(`UPDATE perf_warnings SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
    return NextResponse.json({ warning: toClient(rows[0]) });
  } catch (err) {
    console.error('[performance/warnings/[id] PATCH]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureRosterHydrated();
  const { id } = await params;
  try {
    const { rows: ex } = await query('SELECT issued_by_email FROM perf_warnings WHERE id = $1 LIMIT 1', [id]);
    if (!ex[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const isPerfAdmin = await canAdministerPerformance(user);
    const isIssuer = (ex[0].issued_by_email || '').toLowerCase() === user.email.toLowerCase();
    if (!isPerfAdmin && !isIssuer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    await query('DELETE FROM perf_warnings WHERE id = $1', [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[performance/warnings/[id] DELETE]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
