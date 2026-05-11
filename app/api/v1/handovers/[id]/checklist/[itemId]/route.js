// ── PATCH /api/v1/handovers/:id/checklist/:itemId ──────────────────────
// Toggle a single checklist item complete or incomplete. Caller must be
// the requester, the manager, or a listed coverer. Body:
// { completed: boolean, note?: string }.

import { NextResponse } from 'next/server';
import { withTransaction } from '../../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../../src/lib/auth-helpers';
import {
  loadHandoverWithDetails,
  writeLog,
} from '../../../../../../../src/lib/handover-server';
import { HANDOVER_EVENT_TYPES } from '../../../../../../../src/lib/handover-helpers';
import { isAdminUser } from '../../../../../../../src/lib/queue-scoping';

const lc = (v) => (v || '').toLowerCase().trim();

export async function PATCH(req, ctx) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, itemId } = await ctx.params;

  let body = {};
  try { body = await req.json(); } catch {}
  const completed = body?.completed === true;
  const note = typeof body?.note === 'string' ? body.note.slice(0, 1000) : null;

  try {
    const updated = await withTransaction(async (client) => {
      const handover = await loadHandoverWithDetails(id, { client });
      const caller = lc(user.email);
      const isRequester = lc(handover.requester_email) === caller;
      const isManager   = lc(handover.manager_email) === caller;
      const isCoverer   = handover.coverers.some(c => lc(c.coverer_email) === caller);
      if (!isRequester && !isManager && !isCoverer && !isAdminUser(user)) {
        throw Object.assign(new Error('You cannot edit this checklist'), { status: 403 });
      }

      const itemRow = handover.checklist_items.find(i => i.item_id === itemId);
      if (!itemRow) {
        throw Object.assign(new Error('Checklist item not found'), { status: 404 });
      }
      if (completed === itemRow.completed && note === (itemRow.note || null)) {
        // No-op
        return loadHandoverWithDetails(handover.id, { client });
      }

      await client.query(
        `UPDATE handover_checklist_items
            SET completed = $1,
                note = $2,
                completed_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
                completed_by = CASE WHEN $1 THEN $3 ELSE NULL END
          WHERE handover_id = $4 AND item_id = $5`,
        [completed, note, caller, handover.id, itemId],
      );
      await writeLog(
        client, handover.id,
        completed ? HANDOVER_EVENT_TYPES.CHECKLIST_ITEM_COMPLETED : HANDOVER_EVENT_TYPES.CHECKLIST_ITEM_REOPENED,
        user,
        { item_id: itemId, label: itemRow.label, note },
      );

      return loadHandoverWithDetails(handover.id, { client });
    });
    return NextResponse.json({ handover: updated });
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error('[handovers/:id/checklist/:itemId]', err.message);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status });
  }
}
