// ── POST /api/v1/handovers/:id/accept ──────────────────────────────────
// Coverer accepts. Caller must be the listed coverer; row moves from
// pending → accepted. When the last coverer accepts,
// recomputeAfterCovererChange advances the handover straight to
// APPROVED — TL/manager approval was removed from the state machine
// 2026-05-18 (HANDOVER_TEMPLATE_REVAMP_PLAN.md §4.2).

import { NextResponse } from 'next/server';
import { withTransaction } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import {
  loadHandoverWithDetails,
  findCovererRow,
  writeLog,
  notifyUser,
  recomputeAfterCovererChange,
} from '../../../../../../src/lib/handover-server';
import {
  HANDOVER_STATUSES,
  HANDOVER_EVENT_TYPES,
  HANDOVER_NOTIFICATION_TYPES,
} from '../../../../../../src/lib/handover-helpers';

const lc = (v) => (v || '').toLowerCase().trim();

export async function POST(req, ctx) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  try {
    const updated = await withTransaction(async (client) => {
      const handover = await loadHandoverWithDetails(id, { client });
      if (handover.status !== HANDOVER_STATUSES.PENDING_COVERAGE_ACCEPTANCE) {
        throw Object.assign(new Error(`Cannot accept — handover status is ${handover.status}`), { status: 409 });
      }
      const row = await findCovererRow(handover.id, user.email, client);
      if (!row) {
        throw Object.assign(new Error('You are not listed as a coverer on this handover'), { status: 403 });
      }
      if (row.acceptance_status === 'accepted') {
        // Idempotent — already accepted. Return current state without log spam.
        return handover;
      }

      await client.query(
        `UPDATE handover_coverers
            SET acceptance_status = 'accepted',
                accepted_at = NOW(),
                declined_at = NULL,
                decline_reason = NULL
          WHERE id = $1`,
        [row.id],
      );
      await writeLog(client, handover.id, HANDOVER_EVENT_TYPES.COVERER_ACCEPTED, user, {
        coverer_email: lc(user.email),
      });
      await notifyUser(client, handover.requester_email,
        HANDOVER_NOTIFICATION_TYPES.COVERER_ACCEPTED, handover.id, {
          title: 'Coverer accepted',
          body: `${user.name || user.email} accepted the handover.`,
          actor: user,
        });

      return recomputeAfterCovererChange(client, handover, user)
        .then(() => loadHandoverWithDetails(handover.id, { client }));
    });
    return NextResponse.json({ handover: updated });
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error('[handovers/:id/accept]', err.message);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status });
  }
}
