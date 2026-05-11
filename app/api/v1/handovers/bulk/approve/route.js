// ── POST /api/v1/handovers/bulk/approve ────────────────────────────────
// Phase 5 of HANDOVERS_PLAN.md. Manager efficiency: approve N pending
// handovers in one click from the Table mode's bulk-action toolbar.
//
// Body: { ids: string[], note?: string }. Each id is loaded, validated
// (caller must be manager OR admin/RM), and transitioned within a single
// outer transaction so a partial failure rolls the whole batch back —
// per HANDOVERS_PLAN.md §15 concurrency note.

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

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try { body = await req.json(); } catch {}
  const ids = Array.isArray(body?.ids) ? body.ids.map(String).filter(Boolean).slice(0, 100) : [];
  const note = typeof body?.note === 'string' ? body.note.slice(0, 1000) : null;
  if (ids.length === 0) return NextResponse.json({ error: 'ids[] required' }, { status: 400 });

  try {
    const approved = await withTransaction(async (client) => {
      const out = [];
      for (const id of ids) {
        const handover = await loadHandoverWithDetails(id, { client });
        if (!canApproveHandover(user, handover)) {
          throw Object.assign(new Error(`Cannot approve handover ${id} — not the recorded manager`), { status: 403 });
        }
        if (handover.status !== HANDOVER_STATUSES.PENDING_MANAGER_APPROVAL) {
          throw Object.assign(new Error(`Handover ${id} is in status ${handover.status}, cannot bulk-approve`), { status: 409 });
        }
        const after = await transitionStatus(client, handover, HANDOVER_STATUSES.APPROVED, {
          actor: user,
          logEventType: HANDOVER_EVENT_TYPES.MANAGER_APPROVED,
          logDetail: { note, bulk: true },
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
        out.push(after.id);
      }
      return out;
    });
    return NextResponse.json({ ok: true, approved_ids: approved });
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error('[handovers/bulk/approve]', err.message);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status });
  }
}
