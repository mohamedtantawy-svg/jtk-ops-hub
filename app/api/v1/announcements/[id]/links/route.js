import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';

// GET /api/v1/announcements/:id/links — list all announcements linked to this
// one, in either direction. The UI treats links as bidirectional, so we union
// rows where the current announcement is either source or target; this also
// picks up any legacy one-sided rows written before the bidirectional write
// fix below.
export async function GET(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { rows } = await query(
      `SELECT a.id AS target_id, a.title, a.type, MAX(al.created_at) AS created_at
         FROM announcement_links al
         JOIN announcements a
           ON a.id = CASE WHEN al.source_id = $1 THEN al.target_id ELSE al.source_id END
        WHERE al.source_id = $1 OR al.target_id = $1
        GROUP BY a.id, a.title, a.type
        ORDER BY created_at DESC`,
      [id]
    );
    const items = rows.map(r => ({
      id: r.target_id, targetId: r.target_id, title: r.title, type: r.type,
    }));
    return NextResponse.json({ items });
  } catch (err) {
    console.error('[links GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// POST /api/v1/announcements/:id/links — link two announcements. Writes the
// row in BOTH directions so the link is visible regardless of which side is
// being viewed, and so DELETE doesn't need to know which side originally
// owned it. ON CONFLICT keeps the insert idempotent.
export async function POST(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { targetId } = await req.json();
    if (!targetId) return NextResponse.json({ error: 'targetId required' }, { status: 400 });
    if (targetId === id) return NextResponse.json({ error: 'Cannot link an announcement to itself' }, { status: 400 });

    await query(
      `INSERT INTO announcement_links (source_id, target_id)
       VALUES ($1, $2), ($2, $1)
       ON CONFLICT DO NOTHING`,
      [id, targetId]
    );
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error('[links POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
