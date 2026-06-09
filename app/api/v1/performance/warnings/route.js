// ── /api/v1/performance/warnings ─────────────────────────────────────────────
// Formal performance warnings (verbal / written / final / pip).
// GET  — warnings for ?member=<email> (caller must be able to view them) or,
//        with no member, the caller's own. Org-tree scoped.
// POST — issue a warning to a member (manager-of / perf-admin), optionally
//        linked to a review.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { query } from '../../../../../src/lib/db';
import { getCurrentDeptId } from '../../../../../src/lib/dept-scope';
import { canAdministerPerformance } from '../../../../../src/lib/performance-admin';
import { ensureRosterHydrated } from '../../../../../src/lib/roster-server';
import {
  canViewMemberPerf, canScoreMemberPerf, resolveMemberContext,
} from '../../../../../src/lib/performance-helpers';
import { WARNING_LEVEL_KEYS } from '../../../../../src/lib/performance-constants';

function toClient(w) {
  return {
    id: w.id, orgNodeId: w.org_node_id, memberEmail: w.member_email, memberName: w.member_name,
    level: w.level, reason: w.reason, detail: w.detail, reviewId: w.review_id,
    issuedByEmail: w.issued_by_email, issuedByName: w.issued_by_name, issuedAt: w.issued_at,
    acknowledgedAt: w.acknowledged_at, isResolved: w.is_resolved, resolvedAt: w.resolved_at,
    createdAt: w.created_at, updatedAt: w.updated_at,
  };
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureRosterHydrated();
  try {
    const { searchParams } = new URL(req.url);
    const member = (searchParams.get('member') || '').toLowerCase();
    const me = user.email.toLowerCase();
    let where, params;
    if (member) {
      if (member !== me && !canViewMemberPerf(user, member)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      where = 'LOWER(member_email) = $1'; params = [member];
    } else {
      where = 'LOWER(member_email) = $1'; params = [me];   // own warnings
    }
    const { rows } = await query(
      `SELECT * FROM perf_warnings WHERE ${where} ORDER BY issued_at DESC`, params);
    return NextResponse.json({ warnings: rows.map(toClient) });
  } catch (err) {
    console.error('[performance/warnings GET]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureRosterHydrated();
  try {
    const body = await req.json().catch(() => ({}));
    const memberEmail = String(body.memberEmail || '').toLowerCase();
    const level = String(body.level || 'verbal');
    if (!memberEmail || !WARNING_LEVEL_KEYS.has(level)) {
      return NextResponse.json({ error: 'memberEmail + a valid level are required' }, { status: 400 });
    }
    const isPerfAdmin = await canAdministerPerformance(user);
    if (!canScoreMemberPerf(user, memberEmail, isPerfAdmin)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const ctx = resolveMemberContext(memberEmail);
    const deptId = ctx.orgNodeId || await getCurrentDeptId(user, req);
    const { rows } = await query(
      `INSERT INTO perf_warnings (org_node_id, member_email, member_name, level, reason, detail,
                                  review_id, issued_by_email, issued_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [deptId, memberEmail, ctx.memberName || body.memberName || memberEmail, level,
       body.reason ? String(body.reason).slice(0, 500) : null,
       body.detail ? String(body.detail).slice(0, 4000) : null,
       body.reviewId || null, me(user), user.name || null]);
    return NextResponse.json({ warning: toClient(rows[0]) }, { status: 201 });
  } catch (err) {
    console.error('[performance/warnings POST]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
function me(user) { return (user.email || '').toLowerCase(); }
