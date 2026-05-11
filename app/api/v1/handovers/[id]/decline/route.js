// ── POST /api/v1/handovers/:id/decline ─────────────────────────────────
// Coverer declines (body: { reason }). Row moves to declined; requester
// + manager get a notification so the requester can swap in a new
// coverer. The handover stays in pending_coverage_acceptance — declined
// coverers block recompute from advancing.

import { NextResponse } from 'next/server';
import { withTransaction } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import {
  loadHandoverWithDetails,
  findCovererRow,
  writeLog,
  notifyMany,
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

  let body = {};
  try { body = await req.json(); } catch {}
  const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 1000) : null;

  try {
    const updated = await withTransaction(async (client) => {
      const handover = await loadHandoverWithDetails(id, { client });
      if (handover.status !== HANDOVER_STATUSES.PENDING_COVERAGE_ACCEPTANCE) {
        throw Object.assign(new Error(`Cannot decline — handover status is ${handover.status}`), { status: 409 });
      }
      const row = await findCovererRow(handover.id, user.email, client);
      if (!row) {
        throw Object.assign(new Error('You are not listed as a coverer on this handover'), { status: 403 });
      }
      await client.query(
        `UPDATE handover_coverers
            SET acceptance_status = 'declined',
                declined_at = NOW(),
                decline_reason = $1,
                accepted_at = NULL
          WHERE id = $2`,
        [reason, row.id],
      );
      await writeLog(client, handover.id, HANDOVER_EVENT_TYPES.COVERER_DECLINED, user, {
        coverer_email: lc(user.email),
        reason,
      });
      await notifyMany(client, [
        handover.requester_email,
        handover.manager_email,
      ], HANDOVER_NOTIFICATION_TYPES.COVERER_DECLINED, handover.id, {
        title: 'Coverer declined',
        body: `${user.name || user.email} declined${reason ? `: ${reason}` : '.'}`,
        actor: user,
      });
      return loadHandoverWithDetails(handover.id, { client });
    });
    return NextResponse.json({ handover: updated });
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error('[handovers/:id/decline]', err.message);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status });
  }
}
