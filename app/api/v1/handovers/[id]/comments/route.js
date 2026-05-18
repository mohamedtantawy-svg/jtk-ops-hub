// ── /api/v1/handovers/:id/comments ────────────────────────────────────────
// Phase E of HANDOVER_TEMPLATE_REVAMP_PLAN.md — "Question for requester"
// comment thread, persisted by piggybacking on the existing handover_log
// table (event_type='coverer_question' or 'requester_reply'). Polymorphic
// over the existing audit log so we don't need a new comments table.
//
// GET  → ordered (oldest first) list of comments on this handover.
// POST → append one comment. Author identity is the caller; body { text }
//        and optional { event_type: 'coverer_question' | 'requester_reply' }.
//
// Permission model:
//   • Read: requester, any coverer on this handover, manager_email, admin/RM.
//   • Write: same set. The intent is a back-and-forth thread between
//     coverer + requester (and the TL / RM as silent observers).
// We don't validate that the caller's role matches the event_type — i.e.
// a requester CAN post a 'coverer_question' if they want — because the
// FE drives the label and the audit log just records who said what.

import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { isAdminOrRm } from '../../../../../../src/lib/handover-server';

const ALLOWED_EVENT_TYPES = new Set([
  'coverer_question',
  'requester_reply',
]);

async function loadHandover(id) {
  const { rows } = await query(
    `SELECT id, requester_email, manager_email FROM handovers WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function userCanAccess(user, handoverId) {
  if (!user?.email) return false;
  const h = await loadHandover(handoverId);
  if (!h) return null;                            // 404 sentinel
  if (isAdminOrRm(user)) return true;
  const me = user.email.toLowerCase();
  if ((h.requester_email || '').toLowerCase() === me) return true;
  if ((h.manager_email || '').toLowerCase() === me) return true;
  const { rows } = await query(
    `SELECT 1 FROM handover_coverers WHERE handover_id = $1 AND LOWER(coverer_email) = $2 LIMIT 1`,
    [handoverId, me],
  );
  return rows.length > 0;
}

export async function GET(req, ctx) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing handover id' }, { status: 400 });

  const access = await userCanAccess(user, id);
  if (access === null) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { rows } = await query(
      `SELECT id, event_type, actor_email, actor_name, detail, created_at
         FROM handover_log
        WHERE handover_id = $1
          AND event_type = ANY($2::text[])
        ORDER BY created_at ASC, id ASC`,
      [id, Array.from(ALLOWED_EVENT_TYPES)],
    );
    const items = rows.map(r => ({
      id: r.id,
      event_type: r.event_type,
      actor_email: r.actor_email,
      actor_name: r.actor_name,
      text: r.detail?.text || '',
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    }));
    return NextResponse.json({ items, total: items.length });
  } catch (err) {
    console.error('[handovers/:id/comments GET]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req, ctx) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing handover id' }, { status: 400 });

  const access = await userCanAccess(user, id);
  if (access === null) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const text = String(body?.text || '').trim();
  if (!text) return NextResponse.json({ error: 'text is required' }, { status: 400 });
  if (text.length > 4000) return NextResponse.json({ error: 'text too long (max 4000)' }, { status: 400 });
  const eventType = ALLOWED_EVENT_TYPES.has(body?.event_type) ? body.event_type : 'coverer_question';

  try {
    const { rows } = await query(
      `INSERT INTO handover_log (handover_id, event_type, actor_email, actor_name, detail)
         VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, event_type, actor_email, actor_name, detail, created_at`,
      [id, eventType, user.email, user.name || null, JSON.stringify({ text })],
    );
    const row = rows[0];
    return NextResponse.json({
      item: {
        id: row.id,
        event_type: row.event_type,
        actor_email: row.actor_email,
        actor_name: row.actor_name,
        text: row.detail?.text || '',
        created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      },
    }, { status: 201 });
  } catch (err) {
    console.error('[handovers/:id/comments POST]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
