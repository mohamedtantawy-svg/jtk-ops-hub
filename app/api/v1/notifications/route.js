// ── /api/v1/notifications — per-user notification feed ───────────────────────
// GET: returns the caller's notifications + total unread count. Server is the
// source of truth so unread state is consistent across tabs/devices and the
// bell stays accurate across reloads.
//
// Two-pass shape (2026-05-29): ALL unread come first (capped at UNREAD_CAP),
// then recent read top up the rest of `limit`. A plain `ORDER BY created_at
// DESC LIMIT 50` was hiding older unread behind newer reads — Ayushi had 45
// unread but only a handful surfaced in the bell. Both indexes
// (idx_user_notifications_unread, idx_user_notifications_recipient_created)
// keep this fast.
//
// `flow` is joined in from hr_hub_request for HR Hub rows so the client can
// segregate SLA Extension notifications from regular HR Hub ones.
//
// Recipient is locked to the JWT email — there is no way for a caller to
// fetch someone else's notifications. This is enforced in SQL by filtering
// on LOWER(recipient_email) = LOWER($auth.email).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';
import { getAuthUser } from '../../../../src/lib/auth-helpers';

const UNREAD_CAP = 500; // safety upper bound on a single response

const SELECT_COLUMNS = `
  n.id, n.recipient_email, n.type, n.title, n.body,
  n.link_view, n.link_id, n.source_type, n.source_id,
  n.actor_email, n.actor_name, n.created_at, n.read_at,
  CASE WHEN n.link_view = 'hr_hub' THEN hr.flow ELSE NULL END AS hr_hub_flow
`;

// The `n.link_id::uuid` cast MUST be guarded INSIDE the CASE, not by a
// separate `AND` regex predicate: Postgres doesn't guarantee that predicate
// short-circuits the cast in a JOIN ON, so the planner was evaluating
// link_id::uuid on rows whose link_id is a non-UUID (e.g. a Zendesk/queue
// notification's integer ticket id like "298444"), throwing "invalid input
// syntax for type uuid" on every bell poll and 500ing the whole GET. Casting
// the CASE result means the cast only ever sees a valid UUID string or NULL —
// non-UUID link_ids yield NULL and simply don't join. Still index-friendly
// (hr.id = <uuid> uses the hr_hub_request PK).
const HR_HUB_JOIN = `
  LEFT JOIN hr_hub_request hr
    ON n.link_view = 'hr_hub'
   AND hr.id = (
         CASE WHEN n.link_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN n.link_id ELSE NULL END
       )::uuid
`;

export async function GET(req) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const recipient = String(user.email).toLowerCase();

    const { searchParams } = new URL(req.url);
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '100')));

    // Three queries in parallel: every unread row up to UNREAD_CAP, the most
    // recent reads up to `limit`, and the total unread count (which can
    // exceed UNREAD_CAP — we still want the true number for the badge).
    const [unreadRes, readRes, unreadCountRes] = await Promise.all([
      query(
        `SELECT ${SELECT_COLUMNS}
           FROM user_notifications n
           ${HR_HUB_JOIN}
          WHERE LOWER(n.recipient_email) = $1
            AND n.read_at IS NULL
          ORDER BY n.created_at DESC
          LIMIT $2`,
        [recipient, UNREAD_CAP],
      ),
      query(
        `SELECT ${SELECT_COLUMNS}
           FROM user_notifications n
           ${HR_HUB_JOIN}
          WHERE LOWER(n.recipient_email) = $1
            AND n.read_at IS NOT NULL
          ORDER BY n.created_at DESC
          LIMIT $2`,
        [recipient, limit],
      ),
      query(
        `SELECT COUNT(*)::int AS n
           FROM user_notifications
          WHERE LOWER(recipient_email) = $1
            AND read_at IS NULL`,
        [recipient],
      ),
    ]);

    // Concat unread + reads, then trim. If unread already exceeds `limit`
    // we still ship the full unread set so the bell never under-reports.
    const readBudget = Math.max(0, limit - unreadRes.rows.length);
    const merged = [...unreadRes.rows, ...readRes.rows.slice(0, readBudget)];

    const items = merged.map(r => ({
      id: r.id,
      recipientEmail: r.recipient_email,
      type: r.type,
      title: r.title,
      body: r.body || '',
      linkView: r.link_view,
      linkId: r.link_id,
      sourceType: r.source_type,
      sourceId: r.source_id,
      actorEmail: r.actor_email || null,
      actorName: r.actor_name || null,
      createdAt: r.created_at,
      readAt: r.read_at || null,
      hrHubFlow: r.hr_hub_flow || null,
    }));

    return NextResponse.json({
      items,
      unreadCount: unreadCountRes.rows[0]?.n || 0,
    });
  } catch (err) {
    console.error('[notifications GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
