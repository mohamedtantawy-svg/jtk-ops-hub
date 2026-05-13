// ── GET /api/v1/handovers/lens-counts ──────────────────────────────────
// Per-lens count for the OOO header chip row. Returned counts power both
// the chip badges and the auto-lens selector (HANDOVERS_PLAN.md §3.1).
//
// Phase 1 sketch: the handovers table is empty until Phase 2 ships the
// write path, so approvals / drafts / covering counts are 0 by design.
// 'mine' counts the caller's upcoming events (any handover status), and
// 'team' counts every visible-scope upcoming event so the chip is useful
// from day 1. The shape is forward-compatible — once Phase 2 lands the
// counts naturally reflect real handover state without an API change.

import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
<<<<<<< HEAD
import { getVisibleEmails, isAdminUser } from '../../../../../src/lib/queue-scoping';
=======
<<<<<<< HEAD
import { getVisibleEmails, isAdminUser } from '../../../../../src/lib/queue-scoping';
=======
import { getVisibleOOOEmails, isAdminUser } from '../../../../../src/lib/queue-scoping';
>>>>>>> nexus/dev
>>>>>>> nexus/dev

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const callerEmail = user.email.toLowerCase();

  try {
    // Resolve visible-scope emails once; reuse for team/all queries.
    const visibleEmails = isAdminUser(user)
      ? null
<<<<<<< HEAD
      : Array.from(getVisibleEmails(user)).map(e => String(e).toLowerCase());
=======
<<<<<<< HEAD
      : Array.from(getVisibleEmails(user)).map(e => String(e).toLowerCase());
=======
      : Array.from(getVisibleOOOEmails(user)).map(e => String(e).toLowerCase());
>>>>>>> nexus/dev
>>>>>>> nexus/dev

    // Mine — caller's upcoming events. Missing-handover narrowing is
    // intentionally NOT applied here; the chip count shows total
    // upcoming so the user can see "you have 3 OOO blocks upcoming".
    // The action banner consults a separate is-missing query.
    const mineQ = await query(
      `SELECT COUNT(*)::int AS c
         FROM time_off_events
        WHERE status = 'approved'
          AND end_date >= CURRENT_DATE
          AND LOWER(work_email) = $1`,
      [callerEmail],
    );

    const mineMissingQ = await query(
      `SELECT COUNT(*)::int AS c
         FROM time_off_events e
        WHERE e.status = 'approved'
          AND e.end_date >= CURRENT_DATE
          AND LOWER(e.work_email) = $1
          AND NOT EXISTS (
            SELECT 1 FROM handovers h
             WHERE h.time_off_event_id = e.id
               AND h.status NOT IN ('draft','cancelled','rejected','expired')
          )`,
      [callerEmail],
    );

    const coveringQ = await query(
      `SELECT
         COUNT(*) FILTER (WHERE hc.acceptance_status = 'pending')::int AS pending,
         COUNT(*)::int AS total
       FROM handover_coverers hc
       JOIN handovers h ON h.id = hc.handover_id
       WHERE LOWER(hc.coverer_email) = $1
         AND h.status NOT IN ('cancelled','rejected','expired','completed')
         AND h.end_date >= CURRENT_DATE`,
      [callerEmail],
    );

    const approvalsQ = await query(
      `SELECT COUNT(*)::int AS c
         FROM handovers
        WHERE status = 'pending_manager_approval'
          AND LOWER(manager_email) = $1`,
      [callerEmail],
    );

    const draftsQ = await query(
      `SELECT COUNT(*)::int AS c
         FROM handovers
        WHERE status = 'draft'
          AND LOWER(requester_email) = $1`,
      [callerEmail],
    );

    // Team / all — visible-scope upcoming event count.
    let teamCount = 0;
    let allCount  = 0;
    if (visibleEmails === null) {
      // Admin — count everything currently upcoming or active.
      const r = await query(
        `SELECT COUNT(*)::int AS c
           FROM time_off_events
          WHERE status = 'approved' AND end_date >= CURRENT_DATE`,
      );
      teamCount = r.rows[0]?.c || 0;
      allCount  = teamCount;
    } else if (visibleEmails.length > 0) {
      const r = await query(
        `SELECT COUNT(*)::int AS c
           FROM time_off_events
          WHERE status = 'approved'
            AND end_date >= CURRENT_DATE
            AND LOWER(work_email) = ANY($1::text[])`,
        [visibleEmails],
      );
      teamCount = r.rows[0]?.c || 0;
      // Team excludes the caller (the surface separates Mine vs My team).
      const teamOnly = await query(
        `SELECT COUNT(*)::int AS c
           FROM time_off_events
          WHERE status = 'approved'
            AND end_date >= CURRENT_DATE
            AND LOWER(work_email) = ANY($1::text[])
            AND LOWER(work_email) <> $2`,
        [visibleEmails, callerEmail],
      );
      teamCount = teamOnly.rows[0]?.c || 0;
      allCount = r.rows[0]?.c || 0;
    }

    return NextResponse.json({
      counts: {
        mine:      mineQ.rows[0]?.c || 0,
        mine_missing_handover: mineMissingQ.rows[0]?.c || 0,
        covering:  coveringQ.rows[0]?.total || 0,
        covering_pending: coveringQ.rows[0]?.pending || 0,
        team:      teamCount,
        approvals: approvalsQ.rows[0]?.c || 0,
        drafts:    draftsQ.rows[0]?.c || 0,
        all:       allCount,
      },
    });
  } catch (err) {
    console.error('[handovers/lens-counts GET]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
