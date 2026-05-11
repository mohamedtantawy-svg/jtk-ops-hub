// ── POST /api/v1/handovers/:id/handback ───────────────────────────────
// Phase 5 of HANDOVERS_PLAN.md. The coverer logs their return-day
// handback summary, which completes the state machine (active →
// completed) and ends the workspace merge.
//
// Body:
//   { summary: string, open_items?: Array<{ kind, label, url, source, id }> }
//
// Authorization: caller must be a listed coverer on the handover, OR
// admin/RM. status must be `active`. We allow ONE handback per coverer
// (UNIQUE constraint enforces it). After the row lands, if any coverer
// has logged a handback we transition the handover to `completed`.
// Multi-coverer policy: any single coverer's handback completes the
// handover — they're collectively responsible.

import { NextResponse } from 'next/server';
import { withTransaction } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { isAdminUser } from '../../../../../../src/lib/queue-scoping';
import {
  loadHandoverWithDetails,
  transitionStatus,
  notifyMany,
  writeLog,
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
  const summary = typeof body?.summary === 'string' ? body.summary.slice(0, 5000) : null;
  const openItems = Array.isArray(body?.open_items)
    ? body.open_items.slice(0, 50).map(i => ({
        kind:   typeof i?.kind === 'string'   ? i.kind.slice(0, 40)   : 'note',
        label:  typeof i?.label === 'string'  ? i.label.slice(0, 200) : '',
        url:    typeof i?.url === 'string'    ? i.url.slice(0, 500)   : null,
        source: typeof i?.source === 'string' ? i.source.slice(0, 40) : null,
        id:     typeof i?.id === 'string'     ? i.id.slice(0, 200)    : null,
      }))
    : [];

  if (!summary || summary.trim().length < 10) {
    return NextResponse.json({ error: 'Handback summary is required (min 10 characters)' }, { status: 400 });
  }

  try {
    const updated = await withTransaction(async (client) => {
      const handover = await loadHandoverWithDetails(id, { client });
      if (handover.status !== HANDOVER_STATUSES.ACTIVE) {
        throw Object.assign(new Error(`Cannot log handback — handover status is ${handover.status}`), { status: 409 });
      }
      const callerLc = lc(user.email);
      const isCoverer = handover.coverers.some(c => lc(c.coverer_email) === callerLc);
      if (!isCoverer && !isAdminUser(user)) {
        throw Object.assign(new Error('Only a listed coverer (or admin) can log the handback'), { status: 403 });
      }

      await client.query(
        `INSERT INTO handover_handback (handover_id, ack_email, summary, open_items)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (handover_id, ack_email) DO UPDATE
            SET summary = EXCLUDED.summary,
                open_items = EXCLUDED.open_items,
                acknowledged_at = NOW()`,
        [handover.id, callerLc, summary, JSON.stringify(openItems)],
      );
      await writeLog(client, handover.id, HANDOVER_EVENT_TYPES.HANDBACK_LOGGED, user, {
        coverer_email: callerLc, open_items_count: openItems.length,
      });

      // Transition to completed — any coverer's handback closes the
      // handover (they share responsibility). If for whatever reason
      // multiple coverers log handbacks, the second one re-uses the
      // same final state (idempotent).
      const completed = await transitionStatus(client, handover, HANDOVER_STATUSES.COMPLETED, {
        actor: user,
        logEventType: HANDOVER_EVENT_TYPES.COMPLETED,
        logDetail: { triggered_by: 'handback', coverer_email: callerLc },
        extraColumns: { completed_at: new Date() },
      });

      await notifyMany(client, [
        completed.requester_email,
        ...handover.coverers.map(c => c.coverer_email),
      ], HANDOVER_NOTIFICATION_TYPES.COMPLETED, completed.id, {
        title: `Handover completed by ${user.name || user.email}`,
        body: summary.length > 140 ? summary.slice(0, 140) + '…' : summary,
        actor: user,
      });

      return loadHandoverWithDetails(completed.id, { client });
    });

    return NextResponse.json({ handover: updated });
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error('[handovers/:id/handback]', err.message);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status });
  }
}
