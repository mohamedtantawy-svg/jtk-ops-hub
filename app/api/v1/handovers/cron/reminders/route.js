// ── POST /api/v1/handovers/cron/reminders ──────────────────────────────
// Phase 4 of HANDOVERS_PLAN.md §11. Fires three reminders against
// time_off_events that lack a submitted handover (or whose return-day
// arrived), idempotent via time_off_reminders_sent:
//
//   1. pre_48h  → OOO person, when start_date = today + 2 AND no
//                  in-flight handover for that event
//   2. pre_24h  → OOO person + their manager, when start_date =
//                  today + 1 AND still no in-flight handover
//   3. handback → coverer(s), when the handover is active AND
//                  end_date = today (return-day prompt)
//
// "In-flight" = handover row exists with status NOT IN
// (draft, cancelled, rejected, expired). A draft is treated as missing
// because the OOO person hasn't actually pushed it through yet.
//
// Auth: shared CRON_SECRET bearer token. No JWT, no audit actor.
// Every reminder writes a handover_log row (when a handover exists) +
// a time_off_reminders_sent ledger row keyed by (event_id,
// reminder_type) so subsequent ticks no-op.

import { NextResponse } from 'next/server';
import { query, withTransaction } from '../../../../../../src/lib/db';
import { verifyCronSecret } from '../../../../../../src/lib/cron-auth';
import { notifyUser, writeLog } from '../../../../../../src/lib/handover-server';
import {
  HANDOVER_EVENT_TYPES,
  HANDOVER_NOTIFICATION_TYPES,
} from '../../../../../../src/lib/handover-helpers';
import { MEMBERS_BY_EMAIL } from '../../../../../../src/data/members';

const CRON_ACTOR = { email: 'cron@ops-hub', name: 'Reminders cron' };

export async function POST(req) {
  const auth = verifyCronSecret(req);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const summary = { pre_48h: 0, pre_24h: 0, handback_due: 0, errors: [] };

  try {
    // ── 48-hour reminder ──────────────────────────────────────────────
    // Candidates: approved time-off events whose start_date is exactly
    // (CURRENT_DATE + 2), with no in-flight handover, where the
    // ledger entry for pre_48h has NOT been written.
    const fortyEightHourRows = await query(
      `SELECT e.id, e.work_email, e.start_date, e.end_date
         FROM time_off_events e
        WHERE e.status = 'approved'
          AND e.start_date = CURRENT_DATE + INTERVAL '2 days'
          AND NOT EXISTS (
            SELECT 1 FROM handovers h
             WHERE h.time_off_event_id = e.id
               AND h.status NOT IN ('draft','cancelled','rejected','expired')
          )
          AND NOT EXISTS (
            SELECT 1 FROM time_off_reminders_sent rs
             WHERE rs.time_off_event_id = e.id
               AND rs.reminder_type = 'pre_48h'
          )
        LIMIT 500`,
    );
    for (const ev of fortyEightHourRows.rows) {
      try {
        await withTransaction(async (client) => {
          await notifyUser(client, ev.work_email,
            HANDOVER_NOTIFICATION_TYPES.PRE48H_REMINDER, ev.id, {
              title: 'OOO in 48h — submit a handover',
              body: `Your time-off starts ${ymd(ev.start_date)} but you haven't submitted a handover yet. Tap to open the OOO surface.`,
              actor: CRON_ACTOR,
              sourceType: 'time_off_event',
              sourceId: ev.id,
            });
          await markReminder(client, ev.id, 'pre_48h');
        });
        summary.pre_48h += 1;
      } catch (err) {
        summary.errors.push({ event_id: ev.id, phase: 'pre_48h', message: err?.message });
      }
    }

    // ── 24-hour alert (requester + manager) ──────────────────────────
    const twentyFourHourRows = await query(
      `SELECT e.id, e.work_email, e.start_date, e.end_date
         FROM time_off_events e
        WHERE e.status = 'approved'
          AND e.start_date = CURRENT_DATE + INTERVAL '1 day'
          AND NOT EXISTS (
            SELECT 1 FROM handovers h
             WHERE h.time_off_event_id = e.id
               AND h.status NOT IN ('draft','cancelled','rejected','expired')
          )
          AND NOT EXISTS (
            SELECT 1 FROM time_off_reminders_sent rs
             WHERE rs.time_off_event_id = e.id
               AND rs.reminder_type = 'pre_24h'
          )
        LIMIT 500`,
    );
    for (const ev of twentyFourHourRows.rows) {
      try {
        await withTransaction(async (client) => {
          await notifyUser(client, ev.work_email,
            HANDOVER_NOTIFICATION_TYPES.PRE24H_ALERT, ev.id, {
              title: 'OOO in 24h — handover still missing',
              body: `Your time-off starts ${ymd(ev.start_date)} tomorrow and there's still no submitted handover.`,
              actor: CRON_ACTOR,
              sourceType: 'time_off_event',
              sourceId: ev.id,
            });
          const managerEmail = await resolveManager(client, ev.work_email);
          if (managerEmail && managerEmail.toLowerCase() !== (ev.work_email || '').toLowerCase()) {
            await notifyUser(client, managerEmail,
              HANDOVER_NOTIFICATION_TYPES.PRE24H_MANAGER_ALERT, ev.id, {
                title: 'Direct report has no handover (OOO in 24h)',
                body: `${memberName(ev.work_email)} starts time-off ${ymd(ev.start_date)} but hasn't submitted a handover. Please nudge them.`,
                actor: CRON_ACTOR,
                sourceType: 'time_off_event',
                sourceId: ev.id,
              });
          }
          await markReminder(client, ev.id, 'pre_24h');
        });
        summary.pre_24h += 1;
      } catch (err) {
        summary.errors.push({ event_id: ev.id, phase: 'pre_24h', message: err?.message });
      }
    }

    // ── Handback-due prompt (coverers on return-day) ─────────────────
    const handbackRows = await query(
      `SELECT h.id AS handover_id, h.requester_email, h.start_date, h.end_date,
              h.time_off_event_id
         FROM handovers h
        WHERE h.status = 'active'
          AND h.end_date = CURRENT_DATE
          AND h.time_off_event_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM time_off_reminders_sent rs
             WHERE rs.time_off_event_id = h.time_off_event_id
               AND rs.reminder_type = 'handback_due'
          )
        LIMIT 500`,
    );
    for (const h of handbackRows.rows) {
      try {
        await withTransaction(async (client) => {
          const covRes = await client.query(
            `SELECT coverer_email FROM handover_coverers
              WHERE handover_id = $1 AND acceptance_status = 'accepted'`,
            [h.handover_id],
          );
          for (const c of covRes.rows) {
            await notifyUser(client, c.coverer_email,
              HANDOVER_NOTIFICATION_TYPES.HANDBACK_DUE, h.handover_id, {
                title: 'Handback due',
                body: `${memberName(h.requester_email)} is back today. Log what happened during their leave.`,
                actor: CRON_ACTOR,
              });
          }
          await writeLog(client, h.handover_id, HANDOVER_EVENT_TYPES.REMINDER_HANDBACK_SENT, CRON_ACTOR, {
            coverer_count: covRes.rowCount,
          });
          if (h.time_off_event_id) {
            await markReminder(client, h.time_off_event_id, 'handback_due');
          }
        });
        summary.handback_due += 1;
      } catch (err) {
        summary.errors.push({ handover_id: h.handover_id, phase: 'handback_due', message: err?.message });
      }
    }

    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error('[handovers/cron/reminders]', err);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}

async function markReminder(client, eventId, type) {
  await client.query(
    `INSERT INTO time_off_reminders_sent (time_off_event_id, reminder_type)
     VALUES ($1, $2)
     ON CONFLICT (time_off_event_id, reminder_type) DO NOTHING`,
    [eventId, type],
  );
}

async function resolveManager(client, workEmail) {
  if (!workEmail) return null;
  const direct = MEMBERS_BY_EMAIL[workEmail.toLowerCase()] || null;
  if (direct?.managerEmail) return direct.managerEmail;
  try {
    const r = await client.query(
      `SELECT manager_email FROM team_member_overrides WHERE LOWER(email) = $1 LIMIT 1`,
      [workEmail.toLowerCase()],
    );
    return r.rows[0]?.manager_email || null;
  } catch {
    return null;
  }
}

function memberName(email) {
  const m = MEMBERS_BY_EMAIL[(email || '').toLowerCase()];
  return m?.name || email;
}

function ymd(d) {
  if (!d) return '';
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}
