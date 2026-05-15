// ── POST /api/v1/handovers ─────────────────────────────────────────────
// Phase 2 of HANDOVERS_PLAN.md. Creates a new handover in DRAFT status
// linked to a time_off_events row. The body carries the requested
// coverers (with optional per-coverer country split) and the checklist
// items the requester wants on this handover; missing checklist falls
// back to the global default template seeded by handover-defaults-seed.
//
// Authorization: caller must own the event (work_email = caller) OR be
// admin / regional_manager. State always starts at DRAFT — submit is a
// separate route so the wizard can save a draft without notifying
// coverers prematurely.

import { NextResponse } from 'next/server';
import { query, withTransaction } from '../../../../src/lib/db';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { getVisibleEmails, isAdminUser } from '../../../../src/lib/queue-scoping';
import { ensureRosterHydrated } from '../../../../src/lib/roster-server';
import {
  loadHandoverWithDetails,
  isAdminOrRm,
  writeLog,
  resolveDefaultSettings,
  loadTemplate,
} from '../../../../src/lib/handover-server';
import { HANDOVER_EVENT_TYPES } from '../../../../src/lib/handover-helpers';
import { MEMBERS_BY_EMAIL } from '../../../../src/data/members';

const lc = (v) => (v || '').toLowerCase().trim();

function ensureIsoDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw Object.assign(new Error(`Invalid ${label} (expected YYYY-MM-DD)`), { status: 400 });
  }
  return value;
}

function ensureArray(value, label) {
  if (!Array.isArray(value)) {
    throw Object.assign(new Error(`Invalid ${label} (expected array)`), { status: 400 });
  }
  return value;
}

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Hydrate so MEMBERS_BY_EMAIL[event.work_email] resolves for newly added
  // members (Team-tab adds since pod boot). Manager + name lookups during
  // handover creation depend on this being populated.
  await ensureRosterHydrated();

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const callerEmail = lc(user.email);

  try {
    const eventId = body?.time_off_event_id;
    if (!eventId || typeof eventId !== 'string') {
      return NextResponse.json({ error: 'time_off_event_id is required' }, { status: 400 });
    }

    const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 1000) : null;
    const coverersIn = ensureArray(body?.coverers || [], 'coverers');
    const checklistIn = body?.checklist_items
      ? ensureArray(body.checklist_items, 'checklist_items')
      : null;

    if (coverersIn.length === 0) {
      // We accept zero coverers for drafts so the wizard can save state
      // mid-stream, but submit will refuse to advance — clearly noted in
      // the response so the FE can render the helper text.
    }

    // Self-cover blocked even on drafts (no value saving a draft you
    // can never submit).
    for (const c of coverersIn) {
      if (lc(c?.email) === callerEmail) {
        return NextResponse.json({ error: 'You cannot list yourself as a coverer' }, { status: 400 });
      }
    }

    const created = await withTransaction(async (client) => {
      // Fetch + lock the event so we know the dates + work_email.
      const ev = await client.query(
        `SELECT id, work_email, start_date, end_date, status
           FROM time_off_events WHERE id = $1 FOR UPDATE`,
        [eventId],
      );
      if (ev.rows.length === 0) {
        throw Object.assign(new Error('Time-off event not found'), { status: 404 });
      }
      const event = ev.rows[0];
      if (event.status !== 'approved') {
        throw Object.assign(new Error('Time-off event is not in an approved state'), { status: 409 });
      }

      // Authorization: caller must own the event OR be admin/RM.
      if (lc(event.work_email) !== callerEmail && !isAdminOrRm(user)) {
        throw Object.assign(new Error('You can only create a handover for your own time-off'), { status: 403 });
      }

      // No overlapping in-flight handover for the same requester.
      const overlap = await client.query(
        `SELECT id FROM handovers
          WHERE LOWER(requester_email) = $1
            AND status IN ('pending_coverage_acceptance','pending_manager_approval','approved','active')
            AND NOT (end_date < $2 OR start_date > $3)
          LIMIT 1`,
        [lc(event.work_email), event.start_date, event.end_date],
      );
      if (overlap.rows.length > 0) {
        throw Object.assign(new Error('You already have an in-flight handover overlapping these dates'), { status: 409 });
      }

      // Manager + settings + template resolution.
      const member = MEMBERS_BY_EMAIL[lc(event.work_email)] || null;
      let managerEmail = null;
      try {
        const m = await client.query(
          `SELECT manager_email FROM team_member_overrides WHERE LOWER(email) = $1 LIMIT 1`,
          [lc(event.work_email)],
        );
        managerEmail = m.rows[0]?.manager_email || member?.managerEmail || null;
      } catch {
        managerEmail = member?.managerEmail || null;
      }
      const settings = await resolveDefaultSettings({
        team: member?.team || null,
        region: member?.region || null,
      }, client);
      const managerApprovalRequired = settings?.manager_approval_required !== false;

      // Insert handover.
      const ins = await client.query(
        `INSERT INTO handovers
           (requester_email, start_date, end_date, time_off_event_id, reason,
            status, manager_email, manager_approval_required,
            checklist_template_id, settings_id)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9)
         RETURNING id`,
        [
          lc(event.work_email), event.start_date, event.end_date, event.id, reason,
          managerEmail, managerApprovalRequired,
          settings?.default_template_id || null, settings?.id || null,
        ],
      );
      const handoverId = ins.rows[0].id;

      // Coverers.
      for (const c of coverersIn) {
        const ce = lc(c?.email);
        if (!ce) continue;
        const countries = Array.isArray(c?.country_codes)
          ? c.country_codes.map(x => String(x || '').toUpperCase()).filter(Boolean)
          : [];
        await client.query(
          `INSERT INTO handover_coverers (handover_id, coverer_email, country_codes, acceptance_status)
           VALUES ($1, $2, $3::text[], 'pending')
           ON CONFLICT (handover_id, coverer_email) DO NOTHING`,
          [handoverId, ce, countries],
        );
      }

      // Checklist — use provided items OR snapshot the resolved template.
      let checklist = checklistIn;
      if (!checklist) {
        const tpl = await loadTemplate(settings?.default_template_id || null, client);
        checklist = Array.isArray(tpl?.items) ? tpl.items : [];
      }
      for (const item of checklist) {
        const itemId = String(item?.id || '').slice(0, 80);
        const label  = String(item?.label || '').slice(0, 500);
        if (!itemId || !label) continue;
        const required = item?.required !== false;
        await client.query(
          `INSERT INTO handover_checklist_items (handover_id, item_id, label, required)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (handover_id, item_id) DO NOTHING`,
          [handoverId, itemId, label, required],
        );
      }

      await writeLog(client, handoverId, HANDOVER_EVENT_TYPES.CREATED, user, {
        time_off_event_id: event.id,
        coverers: coverersIn.map(c => lc(c?.email)).filter(Boolean),
        checklist_count: checklist.length,
        settings_id: settings?.id || null,
      });

      return loadHandoverWithDetails(handoverId, { client });
    });

    return NextResponse.json({ handover: created }, { status: 201 });
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error('[handovers POST]', err.message);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status });
  }
}

// ── GET /api/v1/handovers ──────────────────────────────────────────────
// Visible-scope list. Returns handovers (not events) so the FE can power
// the Approvals + Drafts lenses without a join on time_off_events.
// Filters: ?status=…&requester=…&manager=…&from=…&to=…
//
// Visibility: an agent sees own handovers + ones they cover + any
// handover where the requester is in their reporting tree. Admin/RM
// already short-circuit in getVisibleEmails.

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Same fix as time-off-events GET — getVisibleEmails needs hydration
  // so handovers raised by newly added team members surface to peers.
  await ensureRosterHydrated();
  const callerEmail = lc(user.email);

  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const requester = url.searchParams.get('requester');
  const manager = url.searchParams.get('manager');
  const from = url.searchParams.get('from');
  const to   = url.searchParams.get('to');

  const where = [];
  const params = [];
  let p = 1;

  if (status) { where.push(`h.status = $${p++}`); params.push(status); }
  if (requester) { where.push(`LOWER(h.requester_email) = $${p++}`); params.push(lc(requester)); }
  if (manager)   { where.push(`LOWER(h.manager_email) = $${p++}`); params.push(lc(manager)); }
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push(`h.end_date >= $${p++}`); params.push(from); }
  if (to   && /^\d{4}-\d{2}-\d{2}$/.test(to))   { where.push(`h.start_date <= $${p++}`); params.push(to); }

  if (!isAdminUser(user)) {
    const visible = Array.from(getVisibleEmails(user)).map(e => lc(e));
    if (visible.length === 0) {
      where.push('FALSE');
    } else {
      // Visible when requester is in tree, OR caller is a coverer.
      where.push(`(
        LOWER(h.requester_email) = ANY($${p}::text[])
        OR EXISTS (
          SELECT 1 FROM handover_coverers hc2
           WHERE hc2.handover_id = h.id
             AND LOWER(hc2.coverer_email) = $${p + 1}
        )
      )`);
      params.push(visible, callerEmail);
      p += 2;
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const { rows } = await query(
      `SELECT h.id, h.requester_email, h.start_date, h.end_date,
              h.time_off_event_id, h.reason, h.status,
              h.manager_email, h.manager_approval_required,
              h.submitted_at, h.activated_at, h.completed_at,
              h.cancelled_at, h.created_at, h.updated_at,
              (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'email', hc.coverer_email,
                 'country_codes', hc.country_codes,
                 'acceptance_status', hc.acceptance_status
               )), '[]'::jsonb)
                 FROM handover_coverers hc
                WHERE hc.handover_id = h.id) AS coverers
         FROM handovers h
         ${whereSql}
        ORDER BY h.start_date ASC, h.created_at DESC
        LIMIT 500`,
      params,
    );
    return NextResponse.json({ items: rows, total: rows.length });
  } catch (err) {
    console.error('[handovers GET]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
