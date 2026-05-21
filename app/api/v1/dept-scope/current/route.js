// ── /api/v1/dept-scope/current (Phase 11a — 2026-05-20) ────────────────────
// GET  — what dept is the current request scoped to + (for the super-admin)
//        the list of pickable depts.
// POST — global super-admin only. Sets the dept-scope cookie so subsequent
//        scoped reads filter by that dept instead of the super-admin's
//        home dept.

import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import {
  getCurrentDeptId,
  getDescendantNodeIds,
  isGlobalSuperAdmin,
  listTopLevelDepts,
  SUPER_ADMIN_DEPT_COOKIE,
} from '../../../../../src/lib/dept-scope';
import { visibleDeelSourcesFor } from '../../../../../src/lib/dept-integrations';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const deptId = await getCurrentDeptId(user, req);
  const superAdmin = isGlobalSuperAdmin(user);
  let dept = null;
  if (deptId) {
    try {
      const { rows } = await query(
        `SELECT id, name, slug FROM org_nodes WHERE id = $1 LIMIT 1`,
        [deptId],
      );
      if (rows[0]) dept = { id: rows[0].id, name: rows[0].name, slug: rows[0].slug };
    } catch (err) {
      console.warn('[dept-scope/current GET]', err.message);
    }
  }
  const depts = superAdmin ? await listTopLevelDepts() : [];
  // Phase 13a (2026-05-20): per-dept visibility for Deel-source sections.
  // The FE checks this to hide entire surfaces (Onboarding / Offboarding /
  // Amendments / Redlines / Incentive Plans / Workbench) when the current
  // dept's profile doesn't include them — e.g. Global Immigration only
  // shows Workbench (with its own team filter), not the EOR-flavor
  // Onboarding / Offboarding flows. Server-side routes also defense-in-
  // depth check the same flag.
  const visibleSources = visibleDeelSourcesFor(dept?.slug || null);
  // 2026-05-21 — full sub-tree of node-IDs that roll up to the current
  // dept. Phase 0 stamped every existing override row with EOR Operations
  // (a TEAM under HR Experience), not HR Experience itself, so any FE
  // filter that does `member.orgNodeId === currentDeptId` collapses to
  // zero matches. Returning the sub-tree lets the FE do a Set membership
  // check instead of equality. Empty array when deptId is null (e.g.
  // unassigned user before backfill).
  const currentDeptNodeIds = deptId ? await getDescendantNodeIds(deptId) : [];
  return NextResponse.json({
    deptId,
    dept,
    isGlobalSuperAdmin: superAdmin,
    depts,
    visibleSources,
    currentDeptNodeIds,
  });
}

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isGlobalSuperAdmin(user)) {
    // Hard refusal — only the single super-admin can rebind their dept.
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const newDeptId = body?.deptId ? String(body.deptId).trim() : null;
  // null / empty → clear the cookie → super-admin falls back to home dept.
  if (newDeptId) {
    try {
      const { rows } = await query(
        `SELECT id FROM org_nodes
          WHERE id = $1 AND parent_id IS NULL AND is_archived = false LIMIT 1`,
        [newDeptId],
      );
      if (!rows[0]) return NextResponse.json({ error: 'Invalid dept' }, { status: 400 });
    } catch (err) {
      console.warn('[dept-scope/current POST]', err.message);
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
  }
  const res = NextResponse.json({ deptId: newDeptId });
  if (newDeptId) {
    res.cookies.set(SUPER_ADMIN_DEPT_COOKIE, newDeptId, {
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  } else {
    res.cookies.delete(SUPER_ADMIN_DEPT_COOKIE);
  }
  return res;
}
