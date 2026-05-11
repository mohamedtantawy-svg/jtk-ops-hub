// ── POST /api/v1/handovers/:id/reject ──────────────────────────────────
// Manager rejects (body: { reason }). Terminal — requester must create a
// new handover from scratch if they want to retry.

import { NextResponse } from 'next/server';
import { withTransaction } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import {
  loadHandoverWithDetails,
  canApproveHandover,
  transitionStatus,
  notifyUser,
} from '../../../../../../src/lib/handover-server';
import {
  HANDOVER_STATUSES,
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
  if (!reason) {
    return NextResponse.json({ error: 'Rejection reason is required' }, { status: 400 });
  }

  try {
    const updated = await withTransaction(async (client) => {
      const handover = await loadHandoverWithDetails(id, { client });
      if (!canApproveHandover(user, handover)) {
        throw Object.assign(new Error('Only the recorded manager (or admin/RM) can reject this handover'), { status: 403 });
      }
      if (handover.status !== HANDOVER_STATUSES.PENDING_MANAGER_APPROVAL) {
        throw Object.assign(new Error(`Cannot reject — handover status is ${handover.status}`), { status: 409 });
      }
      const after = await transitionStatus(client, handover, HANDOVER_STATUSES.REJECTED, {
        actor: user,
        logEventType: HANDOVER_EVENT_TYPES.MANAGER_REJECTED,
        logDetail: { reason },
        extraColumns: { manager_decision_at: new Date(), manager_decision_note: reason },
      });
      await notifyUser(client, after.requester_email,
        HANDOVER_NOTIFICATION_TYPES.REJECTED, after.id, {
          title: 'Handover rejected',
          body: reason,
          actor: user,
        });
      return loadHandoverWithDetails(after.id, { client });
    });
    return NextResponse.json({ handover: updated });
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error('[handovers/:id/reject]', err.message);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status });
  }
}
