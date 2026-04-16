import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';

export async function GET(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { rows } = await query('SELECT * FROM announcements WHERE id = $1', [id]);
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const r = rows[0];

    // Read canonical acks from announcement_acks table (source of truth)
    const acksResult = await query(
      'SELECT ARRAY_AGG(user_id) AS user_ids FROM announcement_acks WHERE announcement_id = $1',
      [id]
    );
    const acks = acksResult.rows[0]?.user_ids?.map(Number) || [];

    return NextResponse.json({
      id: r.id, type: r.type, title: r.title, body: r.body,
      target: r.target, priority: r.priority, isPopup: r.is_popup,
      imageUrl: r.image_url, link: r.link, status: r.status,
      authorId: r.author_id, pinned: r.pinned,
      acks,
      soundKey: r.sound_key || 'chime',
      sentAt: r.sent_at,
      createdAt: r.created_at, updatedAt: r.updated_at,
    });
  } catch (err) {
    console.error('[announcements/id GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Only admins/managers can edit announcements
    if (!['admin', 'regional_manager', 'manager', 'team_lead'].includes(user.role)) {
      return NextResponse.json({ error: 'Only managers can edit announcements' }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();

    // Enum validation — kept in lockstep with POST + compose UI
    const VALID_TYPES = ['info', 'alert', 'announce', 'celebration', 'policy', 'update', 'guidance', 'kudos', 'general'];
    const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical', 'normal'];
    const VALID_STATUSES = ['draft', 'published', 'sent', 'archived'];
    const VALID_TARGETS = ['all','global','emea','apac','americas','nam','latam'];
    const VALID_SOUNDS = ['chime','alert','kudos','none'];

    if (body.target) body.target = String(body.target).toLowerCase();

    if (body.type && !VALID_TYPES.includes(body.type)) {
      return NextResponse.json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 });
    }
    if (body.priority && !VALID_PRIORITIES.includes(body.priority)) {
      return NextResponse.json({ error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}` }, { status: 400 });
    }
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
    }
    if (body.target && !VALID_TARGETS.includes(body.target)) {
      return NextResponse.json({ error: `Invalid target. Must be one of: ${VALID_TARGETS.join(', ')}` }, { status: 400 });
    }
    if (body.soundKey && !VALID_SOUNDS.includes(body.soundKey)) {
      return NextResponse.json({ error: `Invalid soundKey. Must be one of: ${VALID_SOUNDS.join(', ')}` }, { status: 400 });
    }

    const allowed = ['type', 'title', 'body', 'target', 'priority', 'is_popup', 'image_url', 'link', 'status', 'pinned', 'sound_key'];
    const sets = [];
    const vals = [];
    let idx = 1;

    for (const [key, val] of Object.entries(body)) {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (allowed.includes(col)) {
        sets.push(`${col} = $${idx++}`);
        vals.push(val);
      }
    }

    if (sets.length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
    sets.push('updated_at = NOW()');
    vals.push(id);

    const { rows } = await query(
      `UPDATE announcements SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[announcements/id PATCH]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Only admins can delete announcements
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can delete announcements' }, { status: 403 });
    }

    const { id } = await params;
    await query('DELETE FROM announcements WHERE id = $1', [id]);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[announcements/id DELETE]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
