// ── POST /api/v1/handovers/cron/lifecycle ──────────────────────────────
// Phase 4 of HANDOVERS_PLAN.md. Runs every 15 minutes via the k8s
// CronJob (helm/templates/cronjob-handovers.yaml). Drives the three
// state transitions that aren't user-actuated:
//
//   1. approved → active      when CURRENT_DATE >= start_date
//   2. active   → expired     when CURRENT_DATE > end_date + 14 days
//                              AND no handover_handback row exists
//   3. approved → expired     same grace window if the row never went
//                              active (caller missed the window entirely)
//
// Completion (active → completed) waits for an explicit handback
// submission — that ships with Phase 5.
//
// Auth: bearer token shared between the CronJob and the env var
// CRON_SECRET. No JWT, no auth-helpers — this endpoint is service-to-
// service.
//
// Every transition writes a handover_log row, sends the appropriate
// user_notifications fan-out, and triggers a scope-cache reload so
// merged workspaces flip the moment the cron tick lands.

import { NextResponse } from 'next/server';
import { withTransaction } from '../../../../../../src/lib/db';
import { verifyCronSecret } from '../../../../../../src/lib/cron-auth';
import {
  loadHandoverWithDetails,
  transitionStatus,
  notifyMany,
  notifyUser,
} from '../../../../../../src/lib/handover-server';
import {
  HANDOVER_STATUSES,
  HANDOVER_EVENT_TYPES,
  HANDOVER_NOTIFICATION_TYPES,
} from '../../../../../../src/lib/handover-helpers';

const EXPIRE_GRACE_DAYS = 14;
const CRON_ACTOR = { email: 'cron@ops-hub', name: 'Lifecycle cron' };

export async function POST(req) {
  const auth = verifyCronSecret(req);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const summary = {
    activated: 0,
    expired: 0,
    activated_ids: [],
    expired_ids: [],
    errors: [],
  };

  try {
    // ── Activation pass: approved → active ────────────────────────────
    const activationCandidates = await fetchHandoverIds(`
      SELECT id FROM handovers
       WHERE status = 'approved'
         AND start_date <= CURRENT_DATE
         AND (end_date + INTERVAL '${EXPIRE_GRACE_DAYS} days') >= CURRENT_DATE
       ORDER BY start_date ASC
       LIMIT 200
    `);
    for (const id of activationCandidates) {
      try {
        await withTransaction(async (client) => {
          const handover = await loadHandoverWithDetails(id, { client });
          if (handover.status !== HANDOVER_STATUSES.APPROVED) return;
          const updated = await transitionStatus(client, handover, HANDOVER_STATUSES.ACTIVE, {
            actor: CRON_ACTOR,
            logEventType: HANDOVER_EVENT_TYPES.ACTIVATED,
            logDetail: { reason: 'lifecycle_cron_start_date_reached' },
            extraColumns: { activated_at: new Date() },
          });
          await notifyMany(client, [
            updated.requester_email,
            ...handover.coverers.map(c => c.coverer_email),
          ], HANDOVER_NOTIFICATION_TYPES.ACTIVE, updated.id, {
            title: 'Handover is now active',
            body: `${updated.start_date} → ${updated.end_date} — coverer workspace merge is live`,
            actor: CRON_ACTOR,
          });
        });
        summary.activated += 1;
        summary.activated_ids.push(id);
      } catch (err) {
        summary.errors.push({ id, phase: 'activate', message: err?.message || String(err) });
      }
    }

    // ── Expiry pass: approved/active → expired ─────────────────────────
    const expiryCandidates = await fetchHandoverIds(`
      SELECT h.id FROM handovers h
       WHERE h.status IN ('approved','active')
         AND (h.end_date + INTERVAL '${EXPIRE_GRACE_DAYS} days') < CURRENT_DATE
         AND NOT EXISTS (
           SELECT 1 FROM handover_handback hb WHERE hb.handover_id = h.id
         )
       ORDER BY h.end_date ASC
       LIMIT 200
    `);
    for (const id of expiryCandidates) {
      try {
        await withTransaction(async (client) => {
          const handover = await loadHandoverWithDetails(id, { client });
          if (handover.status !== HANDOVER_STATUSES.APPROVED && handover.status !== HANDOVER_STATUSES.ACTIVE) return;
          await transitionStatus(client, handover, HANDOVER_STATUSES.EXPIRED, {
            actor: CRON_ACTOR,
            logEventType: HANDOVER_EVENT_TYPES.EXPIRED,
            logDetail: { reason: 'lifecycle_cron_grace_window_exceeded', grace_days: EXPIRE_GRACE_DAYS },
          });
          if (handover.manager_email) {
            await notifyUser(client, handover.manager_email,
              HANDOVER_NOTIFICATION_TYPES.EXPIRED, handover.id, {
                title: 'Handover expired',
                body: `${handover.requester_email} · ${handover.start_date} → ${handover.end_date} — no handback received within ${EXPIRE_GRACE_DAYS} days`,
                actor: CRON_ACTOR,
              });
          }
        });
        summary.expired += 1;
        summary.expired_ids.push(id);
      } catch (err) {
        summary.errors.push({ id, phase: 'expire', message: err?.message || String(err) });
      }
    }

    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error('[handovers/cron/lifecycle]', err);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}

async function fetchHandoverIds(sql) {
  // Local import keeps the file size small while still letting the loop
  // body use withTransaction above (which has its own client).
  const { query } = await import('../../../../../../src/lib/db');
  const { rows } = await query(sql);
  return rows.map(r => r.id);
}
