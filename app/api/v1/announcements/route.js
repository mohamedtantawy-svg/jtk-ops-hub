import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';
import { getAuthUser, requireRole } from '../../../../src/lib/auth-helpers';

export async function GET(req) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const target = searchParams.get('target');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '100')));
    const offset = (page - 1) * limit;

    let whereSql = ' WHERE 1=1';
    const params = [];
    let idx = 1;

    if (status) {
      const statuses = status.split(',');
      whereSql += ` AND status = ANY($${idx++})`;
      params.push(statuses);
    }
    if (target) { whereSql += ` AND target = $${idx++}`; params.push(target); }

    const countSql = 'SELECT COUNT(*) FROM announcements' + whereSql;
    const dataSql = 'SELECT id, type, title, body, target, priority, is_popup, image_url, link, status, author_id, pinned, created_at, updated_at FROM announcements' + whereSql + ` ORDER BY pinned DESC, created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    const [{ rows }, countResult] = await Promise.all([
      query(dataSql, params),
      query(countSql, params.slice(0, -2)),
    ]);

    const total = parseInt(countResult.rows[0].count, 10);

    const items = rows.map(r => ({
      id: r.id, type: r.type, title: r.title, body: r.body,
      target: r.target, priority: r.priority, isPopup: r.is_popup,
      imageUrl: r.image_url, link: r.link, status: r.status,
      authorId: r.author_id, pinned: r.pinned,
      createdAt: r.created_at, updatedAt: r.updated_at,
    }));

    return NextResponse.json({ items, page, limit, total });
  } catch (err) {
    console.error('[announcements GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { authorized, user, status, error } = requireRole(req, 'admin', 'manager');
    if (!authorized) return NextResponse.json({ error }, { status });

    const { type, title, body, target, priority, isPopup, imageUrl, link } = await req.json();
    if (!title) return NextResponse.json({ error: 'Title required' }, { status: 400 });

    const { rows } = await query(
      `INSERT INTO announcements (type, title, body, target, priority, is_popup, image_url, link)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [type || 'info', title, body || '', target || 'all', priority || 'normal', isPopup || false, imageUrl || null, link || null]
    );

    const r = rows[0];
    return NextResponse.json({
      id: r.id, type: r.type, title: r.title, body: r.body,
      target: r.target, priority: r.priority, isPopup: r.is_popup,
      status: r.status, createdAt: r.created_at,
    }, { status: 201 });
  } catch (err) {
    console.error('[announcements POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
