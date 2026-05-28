// ── /api/v1/urgent-assist/counts ──────────────────────────────────────────
// Server-side COUNT(*) for the Briefing strip's Urgent Assist tile, in a
// single round trip. Replaces the 3 list calls DecisionsStrip used to make
// (one per actionable status, each capped at 200 rows — admin / RM counts
// truncated for any busy dept).
//
// Returns:
//   { byScope: { all, mine, team, briefingTile }, byStatus: { new, in_progress, on_hold } }
//
// • all          — every row in the dept (admin's view of the universe).
// • mine         — assignee_email = caller (matches the list-route 'mine').
// • team         — assignee_email IN (caller + subtree), same subtree
//                  semantics as the list route (RM/Admin = transitive,
//                  TL = direct reports, agent collapses to mine).
// • briefingTile — role-scoped tile count per Mohamed 2026-05-22 spec:
//                  - Admin       → everything in dept (= all)
//                  - RM / TL     → assigned to caller OR subtree
//                                  (matches list-route `team`)
//                  - Agent       → assigned to caller (matches `mine`)
//
// Only actionable statuses (new + in_progress + on_hold) are counted —
// resolved rows are out of scope for the tile.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { query } from '../../../../../src/lib/db';
import { ensureRosterHydrated } from '../../../../../src/lib/roster-server';
import { memberByEmail } from '../../../../../src/lib/urgent-assist-helpers';
import { MEMBERS_BY_EMAIL, getDirectReports, getAllReports } from '../../../../../src/data/members';
import { getCurrentDeptId } from '../../../../../src/lib/dept-scope';
import { reconcileUrgentAssistFromUpstream } from '../../../../../src/lib/urgent-assist-reconciler';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureRosterHydrated();

  // Briefing's DecisionsStrip Urgent Assist tile reads these counts; if
  // the list GET (which runs the reconciler) hasn't fired in the last
  // minute, the tile would still report rows whose workbench-linked
  // upstream task has already closed. Module-level throttle in the
  // reconciler keeps the cost effectively-zero when the list GET ran
  // recently (single shared in-flight Promise, no double-scan).
  await reconcileUrgentAssistFromUpstream();

  const callerEmail = String(user.email).toLowerCase();
  const me = MEMBERS_BY_EMAIL[callerEmail];
  const access = (me?.access || '').toLowerCase();
  const isAdmin = access === 'admin';
  const isManager = access === 'team_lead' || access === 'regional_manager' || isAdmin;

  // Build the team subtree using the SAME predicate the list route uses
  // so the tile count matches what the user sees inside the Urgent Assist
  // view when they pick the "Team" scope toggle.
  const teamSet = new Set([callerEmail]);
  if (isAdmin || access === 'regional_manager') {
    for (const e of getAllReports(callerEmail)) teamSet.add(e);
  } else if (access === 'team_lead') {
    for (const r of getDirectReports(callerEmail)) teamSet.add(r.email);
  }
  const teamEmails = Array.from(teamSet);
  const teamHasReports = teamSet.size > 1;

  // Dept-isolate every read — Phase 11f. Missing dept fails closed.
  const currentDeptId = await getCurrentDeptId(user, req);
  const where = [];
  const params = [];
  let p = 1;
  if (currentDeptId) {
    where.push(`org_node_id = $${p++}`);
    params.push(currentDeptId);
  } else {
    where.push(`FALSE`);
  }
  // Only actionable rows on the tile — resolved is out of scope.
  where.push(`status IN ('new', 'in_progress', 'on_hold')`);

  const callerPlaceholder = `$${p++}`;
  params.push(callerEmail);
  const teamArrayPlaceholder = `$${p++}::text[]`;
  params.push(teamEmails);

  // briefingTile predicate:
  //   - Admin       → TRUE
  //   - RM / TL     → assignee IN (caller + subtree)
  //   - Agent       → assignee = caller
  let briefingTilePredicate;
  if (isAdmin) {
    briefingTilePredicate = 'TRUE';
  } else if (isManager && teamHasReports) {
    briefingTilePredicate = `LOWER(COALESCE(assignee_email,'')) = ANY(${teamArrayPlaceholder})`;
  } else {
    briefingTilePredicate = `LOWER(COALESCE(assignee_email,'')) = ${callerPlaceholder}`;
  }

  const sql = `
    SELECT
      COUNT(*)::int                                                                        AS all_count,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(assignee_email,'')) = ${callerPlaceholder})::int                    AS mine_count,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(assignee_email,'')) = ANY(${teamArrayPlaceholder}))::int            AS team_count,
      COUNT(*) FILTER (WHERE ${briefingTilePredicate})::int                                 AS briefing_tile_count,
      COUNT(*) FILTER (WHERE status = 'new')::int                                           AS new_count,
      COUNT(*) FILTER (WHERE status = 'in_progress')::int                                   AS in_progress_count,
      COUNT(*) FILTER (WHERE status = 'on_hold')::int                                       AS on_hold_count
    FROM urgent_assist_request
    WHERE ${where.join(' AND ')}`;

  try {
    const { rows } = await query(sql, params);
    const r = rows[0] || {};
    return NextResponse.json({
      byScope: {
        all:          Number(r.all_count)            || 0,
        mine:         Number(r.mine_count)           || 0,
        team:         Number(r.team_count)           || 0,
        briefingTile: Number(r.briefing_tile_count)  || 0,
      },
      byStatus: {
        new:         Number(r.new_count)         || 0,
        in_progress: Number(r.in_progress_count) || 0,
        on_hold:     Number(r.on_hold_count)     || 0,
      },
    });
  } catch (err) {
    console.error('[urgent-assist.counts]', err.message);
    return NextResponse.json({ error: 'Internal error', detail: err.message }, { status: 500 });
  }
}
