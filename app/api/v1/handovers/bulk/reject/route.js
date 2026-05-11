// ── POST /api/v1/handovers/bulk/reject ─────────────────────────────────
// Mirror of bulk approve. Body: { ids: string[], reason: string }.
// Reason is required (mirrors the single-reject route). Atomic — a
// 4xx on any one id rolls the whole batch back so the manager can fix
// + retry without partial state.

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

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try { body = await req.json(); } catch {}
  const ids = Array.isArray(body?.ids) ? body.ids.map(String).filter(Boolean).slice(0, 100) : [];
  const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 1000) : null;
  if (ids.length === 0) return NextResponse.json({ error: 'ids[] required' }, { status: 400 });
  if (!reason) return NextResponse.json({ error: 'A rejection reason is required' }, { status: 400 });

  try {
    const rejected = await withTransaction(async (client) => {
      const out = [];
      for (const id of ids) {
        const handover = await loadHandoverWithDetails(id, { client });
        if (!canApproveHandover(user, handover)) {
          throw Object.assign(new Error(`Cannot reject handover ${id} — not the recorded manager`), { status: 403 });
        }
        if (handover.status !== HANDOVER_STATUSES.PENDING_MANAGER_APPROVAL) {
          throw Object.assign(new Error(`Handover ${id} is in status ${handover.status}, cannot bulk-reject`), { status: 409 });
        }
        const after = await transitionStatus(client, handover, HANDOVER_STATUSES.REJECTED, {
          actor: user,
          logEventType: HANDOVER_EVENT_TYPES.MANAGER_REJECTED,
          logDetail: { reason, bulk: true },
          extraColumns: { manager_decision_at: new Date(), manager_decision_note: reason },
        });
        await notifyUser(client, after.requester_email,
          HANDOVER_NOTIFICATION_TYPES.REJECTED, after.id, {
            title: 'Handover rejected', body: reason, actor: user,
          });
        out.push(after.id);
      }
      return out;
    });
    return NextResponse.json({ ok: true, rejected_ids: rejected });
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error('[handovers/bulk/reject]', err.message);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status });
  }
}
