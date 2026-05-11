// ── POST /api/v1/handovers/:id/approve ─────────────────────────────────
// Manager approves a handover sitting in pending_manager_approval.
// Caller must be the recorded manager OR admin/RM. Optional body:
// { note: string }.

import { NextResponse } from 'next/server';
import { withTransaction } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import {
  loadHandoverWithDetails,
  canApproveHandover,
  transitionStatus,
  notifyMany,
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
  const note = typeof body?.note === 'string' ? body.note.slice(0, 1000) : null;

  try {
    const updated = await withTransaction(async (client) => {
      const handover = await loadHandoverWithDetails(id, { client });
      if (!canApproveHandover(user, handover)) {
        throw Object.assign(new Error('Only the recorded manager (or admin/RM) can approve this handover'), { status: 403 });
      }
      if (handover.status !== HANDOVER_STATUSES.PENDING_MANAGER_APPROVAL) {
        throw Object.assign(new Error(`Cannot approve — handover status is ${handover.status}`), { status: 409 });
      }
      const after = await transitionStatus(client, handover, HANDOVER_STATUSES.APPROVED, {
        actor: user,
        logEventType: HANDOVER_EVENT_TYPES.MANAGER_APPROVED,
        logDetail: { note },
        extraColumns: { manager_decision_at: new Date(), manager_decision_note: note },
      });
      await notifyMany(client, [
        after.requester_email,
        ...handover.coverers.map(c => c.coverer_email),
      ], HANDOVER_NOTIFICATION_TYPES.APPROVED, after.id, {
        title: 'Handover approved',
        body: `${after.start_date} → ${after.end_date}`,
        actor: user,
      });
      return loadHandoverWithDetails(after.id, { client });
    });
    return NextResponse.json({ handover: updated });
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error('[handovers/:id/approve]', err.message);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status });
  }
}
