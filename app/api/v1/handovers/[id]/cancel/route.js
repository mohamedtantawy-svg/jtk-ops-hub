// ── POST /api/v1/handovers/:id/cancel ──────────────────────────────────
// Requester, manager, or admin cancels from any non-terminal state.
// Optional body: { reason }. Notifies requester + coverers + manager so
// nobody is left guessing.

import { NextResponse } from 'next/server';
import { withTransaction } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import {
  loadHandoverWithDetails,
  canCancelHandover,
  isAdminOrRm,
  transitionStatus,
  notifyMany,
} from '../../../../../../src/lib/handover-server';
import {
  HANDOVER_STATUSES,
  TERMINAL_STATUSES,
  HANDOVER_EVENT_TYPES,
  HANDOVER_NOTIFICATION_TYPES,
} from '../../../../../../src/lib/handover-helpers';

export async function POST(req, ctx) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  let body = {};
  try { body = await req.json(); } catch {}
  const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 1000) : null;
  const force = body?.force === true;

  try {
    const updated = await withTransaction(async (client) => {
      const handover = await loadHandoverWithDetails(id, { client });
      if (!canCancelHandover(user, handover) && !(force && isAdminOrRm(user))) {
        throw Object.assign(new Error('You cannot cancel this handover'), { status: 403 });
      }
      if (TERMINAL_STATUSES.has(handover.status)) {
        throw Object.assign(new Error(`Handover already in terminal state: ${handover.status}`), { status: 409 });
      }
      const after = await transitionStatus(client, handover, HANDOVER_STATUSES.CANCELLED, {
        actor: user,
        logEventType: force ? HANDOVER_EVENT_TYPES.FORCE_CANCELLED : HANDOVER_EVENT_TYPES.CANCELLED,
        logDetail: { reason, force },
        extraColumns: {
          cancelled_at: new Date(),
          cancelled_by: (user.email || '').toLowerCase(),
          cancel_reason: reason,
        },
      });
      await notifyMany(client, [
        after.requester_email,
        after.manager_email,
        ...handover.coverers.map(c => c.coverer_email),
      ], HANDOVER_NOTIFICATION_TYPES.CANCELLED, after.id, {
        title: 'Handover cancelled',
        body: reason || 'Cancelled by ' + (user.name || user.email),
        actor: user,
      });
      return loadHandoverWithDetails(after.id, { client });
    });
    return NextResponse.json({ handover: updated });
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error('[handovers/:id/cancel]', err.message);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status });
  }
}
