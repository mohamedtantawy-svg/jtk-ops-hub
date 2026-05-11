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
//   ?lens=mine|covering|team|approvals|drafts|all
//       — server-side narrowing matching the FE chip the user picked.
//         Defaults to `all` (caller filters client-side if needed).
//
// Visibility is enforced via getVisibleEmails(user) — same scoping the
// Queue / Briefing / HR Hub already use, so an agent never sees outside
// their reporting tree.

import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { getVisibleEmails, isAdminUser } from '../../../../src/lib/queue-scoping';
import { LENS_IDS } from '../../../../src/lib/handover-helpers';

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

  const url = new URL(req.url);
  const from = normaliseDate(url.searchParams.get('from'));
  const to   = normaliseDate(url.searchParams.get('to'));
  const explicitEmail = (url.searchParams.get('work_email') || '').toLowerCase().trim() || null;
  const lensRaw = (url.searchParams.get('lens') || LENS_IDS.ALL).toLowerCase();
  const lens = VALID_LENSES.has(lensRaw) ? lensRaw : LENS_IDS.ALL;

  const callerEmail = user.email.toLowerCase();
  const params = [];
  let p = 1;

  const where = [`e.status = 'approved'`];

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
  } else if (lens === LENS_IDS.APPROVALS) {
    where.push(`
      EXISTS (
        SELECT 1 FROM handovers h
         WHERE h.time_off_event_id = e.id
           AND h.status = 'pending_manager_approval'
           AND LOWER(h.manager_email) = $${p++}
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
  // by their reporting tree. Skipped for 'mine'/'drafts' since the
  // caller-email predicate already narrows further.
  if (!isAdminUser(user) && lens !== LENS_IDS.MINE && lens !== LENS_IDS.DRAFTS) {
    const visible = Array.from(getVisibleEmails(user));
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
      e.id, e.work_email, e.start_date, e.end_date, e.source, e.external_id, e.status, e.reason,
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
