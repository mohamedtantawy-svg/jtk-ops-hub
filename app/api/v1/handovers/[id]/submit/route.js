// ── POST /api/v1/handovers/:id/submit ──────────────────────────────────
// Move a draft to pending_coverage_acceptance + notify every coverer.
// Requirements: caller is the requester (or admin/RM), at least one
// coverer is listed, every required checklist item is checked.

import { NextResponse } from 'next/server';
import { withTransaction } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import {
  loadHandoverWithDetails,
  canModifyHandover,
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

  try {
    const updated = await withTransaction(async (client) => {
      const handover = await loadHandoverWithDetails(id, { client });
      if (!canModifyHandover(user, handover)) {
        throw Object.assign(new Error('You cannot submit this handover'), { status: 403 });
      }
      if (handover.status !== HANDOVER_STATUSES.DRAFT) {
        throw Object.assign(new Error(`Only drafts can be submitted (current: ${handover.status})`), { status: 409 });
      }
      if (!Array.isArray(handover.coverers) || handover.coverers.length === 0) {
        throw Object.assign(new Error('Add at least one coverer before submitting'), { status: 400 });
      }
      const missingRequired = (handover.checklist_items || []).filter(i => i.required && !i.completed);
      if (missingRequired.length > 0) {
        throw Object.assign(new Error(`${missingRequired.length} required checklist item(s) not yet completed`), { status: 400 });
      }

      const after = await transitionStatus(client, handover, HANDOVER_STATUSES.PENDING_COVERAGE_ACCEPTANCE, {
        actor: user,
        logEventType: HANDOVER_EVENT_TYPES.SUBMITTED,
        logDetail: { coverer_count: handover.coverers.length },
        extraColumns: { submitted_at: new Date() },
      });

      // Notify each coverer + log per-coverer invite.
      const coverers = handover.coverers.map(c => c.coverer_email);
      await notifyMany(
        client,
        coverers,
        HANDOVER_NOTIFICATION_TYPES.COVERAGE_INVITED,
        after.id,
        {
          title: 'You\'ve been asked to cover a handover',
          body: `${after.requester_email} · ${after.start_date} → ${after.end_date}`,
          actor: user,
        },
      );
      for (const c of handover.coverers) {
        await client.query(
          `INSERT INTO handover_log (handover_id, event_type, actor_email, actor_name, detail)
           VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [
            after.id,
            HANDOVER_EVENT_TYPES.COVERER_INVITED,
            (user?.email || '').toLowerCase() || null,
            user?.name || null,
            JSON.stringify({ coverer_email: c.coverer_email, country_codes: c.country_codes }),
          ],
        );
      }

      return loadHandoverWithDetails(after.id, { client });
    });
    return NextResponse.json({ handover: updated });
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error('[handovers/:id/submit]', err.message);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status });
  }
}
