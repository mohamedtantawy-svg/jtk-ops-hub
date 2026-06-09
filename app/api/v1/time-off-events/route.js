// ── GET /api/v1/time-off-events ─────────────────────────────────────────
// Phase 1 of HANDOVERS_PLAN.md. Returns the visible-scope time-off events
// for the OOO surface (Calendar + Table modes, all lens types). Each row
// joins its in-flight handover when one exists so the FE can render the
// status badge in a single pass.
//
// Query params:
//   ?from=YYYY-MM-DD     — clip to events ending on or after this date
//   ?to=YYYY-MM-DD       — clip to events starting on or before this date
//   ?work_email=foo@bar  — single-person filter (used by the detail panel)
//   ?lens=mine|covering|team|drafts|all
//       — server-side narrowing matching the FE chip the user picked.
//         Defaults to `all` (caller filters client-side if needed).
//         The `approvals` lens was removed 2026-05-18 (TL approval
//         teardown — HANDOVER_TEMPLATE_REVAMP_PLAN.md §4.2).
//
// Visibility is enforced via getVisibleOOOEmails(user) — the OOO-specific
// cohort (Fernanda 2026-05-13). Broader than the Queue / HR scoping so
// peer TLs / peer RMs and intra-team agents can see each other's leave.

import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { getVisibleOOOEmails, isAdminUser, canManageTimeOffFor } from '../../../../src/lib/queue-scoping';
import { ensureRosterHydrated } from '../../../../src/lib/roster-server';
import { LENS_IDS } from '../../../../src/lib/handover-helpers';
import { getCurrentDeptId, getTopLevelDeptForMember } from '../../../../src/lib/dept-scope';

const VALID_LENSES = new Set(Object.values(LENS_IDS));

function normaliseDate(input) {
  if (!input || typeof input !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(input) ? input : null;
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Hydrate the server-side roster so getVisibleOOOEmails / canManageTimeOffFor
  // see members added via the Team tab. Without this, a freshly-booted pod
  // only knows the static TEAM_MEMBERS baseline (104 names) — any member
  // added since boot is invisible to scoping, so their OOO events get
  // filtered out at the SQL `LOWER(e.work_email) = ANY(visible)` check
  // even when they DO have approved entries. Madeleine Decuir 2026-05-15
  // repro: "I don't see Katarina, Victor or Amanda on the OOO calendar".
  await ensureRosterHydrated();

  const url = new URL(req.url);
  const from = normaliseDate(url.searchParams.get('from'));
  const to   = normaliseDate(url.searchParams.get('to'));
  const explicitEmail = (url.searchParams.get('work_email') || '').toLowerCase().trim() || null;
  const lensRaw = (url.searchParams.get('lens') || LENS_IDS.ALL).toLowerCase();
  const lens = VALID_LENSES.has(lensRaw) ? lensRaw : LENS_IDS.ALL;

  const callerEmail = user.email.toLowerCase();
  const params = [];
  let p = 1;

  // Phase 11e (2026-05-20): dept-isolate time-off reads. Every row belongs
  // to the dept of its work_email — we filter by org_node_id of the event
  // itself (stamped at write time + by Phase 11a backfill).
  const currentDeptId = await getCurrentDeptId(user, req);
  const where = [`e.status = 'approved'`];
  if (currentDeptId) {
    where.push(`e.org_node_id = $${p++}`);
    params.push(currentDeptId);
  } else {
    where.push(`FALSE`);
  }

  if (from) { where.push(`e.end_date >= $${p++}`); params.push(from); }
  if (to)   { where.push(`e.start_date <= $${p++}`); params.push(to); }
  if (explicitEmail) { where.push(`LOWER(e.work_email) = $${p++}`); params.push(explicitEmail); }

  // Lens-specific narrowing. Most lenses also clip by visible-scope below;
  // 'mine' / 'drafts' implicitly clip to caller so an extra visible filter
  // is redundant but harmless.
  if (lens === LENS_IDS.MINE) {
    where.push(`LOWER(e.work_email) = $${p++}`);
    params.push(callerEmail);
  } else if (lens === LENS_IDS.COVERING) {
    // Events where the caller is listed as a coverer (any state — the FE
    // sorts pending vs accepted on its end).
    where.push(`
      EXISTS (
        SELECT 1 FROM handovers h
          JOIN handover_coverers hc ON hc.handover_id = h.id
         WHERE h.time_off_event_id = e.id
           AND LOWER(hc.coverer_email) = $${p++}
      )`);
    params.push(callerEmail);
  } else if (lens === LENS_IDS.DRAFTS) {
    where.push(`
      EXISTS (
        SELECT 1 FROM handovers h
         WHERE h.time_off_event_id = e.id
           AND h.status = 'draft'
           AND LOWER(h.requester_email) = $${p++}
      )`);
    params.push(callerEmail);
  }
  // 'team' and 'all' use the visible-scope clip below; no extra predicate.

  // Visible-scope clip — admins skip the filter; everyone else is bounded
  // by their reporting tree. Skipped for lenses whose own predicate already
  // authorises the caller on each row:
  //   • 'mine' / 'drafts' — filter by caller-email directly
  //   • 'covering'        — EXISTS predicate already requires the caller
  //     to be the explicit coverer. Coverage invitations routinely cross
  //     reporting-tree boundaries (peer TL covering for a peer, etc.),
  //     so layering the visible-scope clip on top stranded those rows —
  //     Megan reported 2026-05-15 that her "1 coverage invitation needs
  //     your response" banner showed but the list rendered empty because
  //     the requester sat outside her tree. `getVisibleOOOEmails` is the
  //     right read scope for "browse other people's OOO" (Team/All), but
  //     it's the wrong scope when the row's own authorisation says you
  //     belong on it.
  //   • 'all'             — Christina Shalaby feedback 2026-05-25:
  //     non-managers need full-dept visibility to plan triage / urgent-
  //     assist coverage. The dept filter above (`e.org_node_id =
  //     currentDeptId`) already enforces tenancy — every row visible
  //     under 'all' belongs to the caller's dept, so layering the
  //     reporting-tree clip on top wrongly collapses 'all' to 'team'
  //     for non-managers. Lens 'all' literally means "everything in
  //     scope" (LENSES hint copy) where scope = current dept.
  if (
    !isAdminUser(user) &&
    lens !== LENS_IDS.MINE &&
    lens !== LENS_IDS.DRAFTS &&
    lens !== LENS_IDS.COVERING &&
    lens !== LENS_IDS.ALL
  ) {
    const visible = Array.from(getVisibleOOOEmails(user));
    if (visible.length === 0) {
      where.push('FALSE');
    } else {
      where.push(`LOWER(e.work_email) = ANY($${p++}::text[])`);
      params.push(visible.map(em => String(em).toLowerCase()));
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // LATERAL pulls the canonical in-flight handover for the event (most
  // recent non-terminal). One-to-one is enforced at write time in Phase 2
  // (overlapping submitted handovers by the same requester are blocked);
  // the LATERAL stays here as defence-in-depth so the API row count
  // always matches the event count even on slightly malformed data.
  const sql = `
    SELECT
      e.id, e.work_email, e.start_date, e.end_date, e.source, e.external_id, e.status, e.reason, e.leave_type,
      h.id            AS handover_id,
      h.status        AS handover_status,
      h.requester_email AS handover_requester_email,
      h.manager_email AS handover_manager_email,
      h.submitted_at  AS handover_submitted_at,
      h.activated_at  AS handover_activated_at,
      COALESCE(hc.coverers, '[]'::jsonb)        AS handover_coverers,
      COALESCE(ci.progress, jsonb_build_object('total', 0, 'done', 0)) AS handover_checklist_progress
    FROM time_off_events e
    LEFT JOIN LATERAL (
      SELECT *
        FROM handovers h2
       WHERE h2.time_off_event_id = e.id
         AND h2.status NOT IN ('cancelled','rejected','expired')
       ORDER BY h2.created_at DESC
       LIMIT 1
    ) h ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'email', hc2.coverer_email,
        'country_codes', hc2.country_codes,
        'acceptance_status', hc2.acceptance_status,
        'invited_at', hc2.invited_at,
        'accepted_at', hc2.accepted_at,
        'declined_at', hc2.declined_at
      )) AS coverers
        FROM handover_coverers hc2
       WHERE hc2.handover_id = h.id
    ) hc ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'total', COUNT(*),
        'done',  COUNT(*) FILTER (WHERE completed = true)
      ) AS progress
        FROM handover_checklist_items ci2
       WHERE ci2.handover_id = h.id
    ) ci ON TRUE
    ${whereSql}
    ORDER BY e.start_date ASC, LOWER(e.work_email) ASC
    LIMIT 5000
  `;

  try {
    const { rows } = await query(sql, params);

    const items = rows.map(r => ({
      id: r.id,
      work_email: r.work_email,
      start_date: r.start_date instanceof Date ? r.start_date.toISOString().slice(0, 10) : r.start_date,
      end_date:   r.end_date   instanceof Date ? r.end_date.toISOString().slice(0, 10)   : r.end_date,
      source: r.source,
      external_id: r.external_id,
      status: r.status,
      reason: r.reason,
      leave_type: r.leave_type,
      handover: r.handover_id ? {
        id: r.handover_id,
        status: r.handover_status,
        requester_email: r.handover_requester_email,
        manager_email: r.handover_manager_email,
        submitted_at: r.handover_submitted_at,
        activated_at: r.handover_activated_at,
        coverers: r.handover_coverers || [],
        checklist_progress: r.handover_checklist_progress || { total: 0, done: 0 },
      } : null,
    }));

    return NextResponse.json({ items, total: items.length, lens });
  } catch (err) {
    console.error('[time-off-events GET]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── POST /api/v1/time-off-events ────────────────────────────────────────
// Manually submit a new approved time-off entry, mirroring what would
// normally land via the Deel platform import. Per Lucy's 2026-05-13 ask
// (ticket "Upcoming OOO not accurate") — Ops Hub's auto-imported OOO can
// be out of sync with Deel's source of truth; team members and managers
// need an escape hatch to correct it inline.
//
// Permission model (enforced via canManageTimeOffFor):
//   • Agents      — themselves only
//   • Team Leads  — themselves + direct reports
//   • Regional Mgrs — themselves + full subtree
//   • Admin       — anyone
//
// Idempotency: the (work_email, start_date, end_date, source) unique
// constraint catches a duplicate submit — we ON CONFLICT bump the reason
// + updated_at, returning the existing row so retries are safe.
export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const workEmail = String(body.work_email || '').toLowerCase().trim();
  const startDate = normaliseDate(body.start_date);
  const endDate = normaliseDate(body.end_date);
  const reasonRaw = typeof body.reason === 'string' ? body.reason.trim() : '';
  const reason = reasonRaw ? reasonRaw.slice(0, 80) : null;

  if (!workEmail) return NextResponse.json({ error: 'work_email is required' }, { status: 400 });
  if (!startDate || !endDate) return NextResponse.json({ error: 'start_date and end_date must be YYYY-MM-DD' }, { status: 400 });
  if (endDate < startDate) return NextResponse.json({ error: 'end_date must be on or after start_date' }, { status: 400 });

  await ensureRosterHydrated();

  if (!canManageTimeOffFor(user, workEmail)) {
    return NextResponse.json(
      { error: 'You can only submit time off for yourself or your direct reports.' },
      { status: 403 },
    );
  }

  try {
    // Phase 11e: stamp the work_email's home dept (not the actor's) — a
    // manager submitting OOO for a report writes the row into the
    // report's dept, not the manager's. Falls back to null if dept can't
    // be resolved; the backfill picks those up on next boot.
    const subjectDept = await getTopLevelDeptForMember(workEmail);
    const subjectDeptId = subjectDept?.deptId || null;

    const insert = await query(
      `INSERT INTO time_off_events (work_email, start_date, end_date, source, status, reason, org_node_id)
       VALUES ($1, $2, $3, 'manual', 'approved', $4, $5)
       ON CONFLICT (work_email, start_date, end_date, source) DO UPDATE
         SET reason = EXCLUDED.reason, updated_at = NOW()
       RETURNING id, work_email, start_date, end_date, source, status, reason`,
      [workEmail, startDate, endDate, reason, subjectDeptId],
    );
    const row = insert.rows[0];
    return NextResponse.json({
      item: {
        id: row.id,
        work_email: row.work_email,
        start_date: row.start_date instanceof Date ? row.start_date.toISOString().slice(0, 10) : row.start_date,
        end_date: row.end_date instanceof Date ? row.end_date.toISOString().slice(0, 10) : row.end_date,
        source: row.source,
        status: row.status,
        reason: row.reason,
        handover: null,
      },
    }, { status: 201 });
  } catch (err) {
    console.error('[time-off-events POST]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
