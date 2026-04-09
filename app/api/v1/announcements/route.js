import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const target = searchParams.get('target');
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);

    let sql = 'SELECT * FROM announcements WHERE 1=1';
    const params = [];
    let idx = 1;

    if (status) {
      const statuses = status.split(',');
      sql += ` AND status = ANY($${idx++})`;
      params.push(statuses);
    }
    if (target) { sql += ` AND target = $${idx++}`; params.push(target); }

    sql += ` ORDER BY pinned DESC, created_at DESC LIMIT $${idx++}`;
    params.push(limit);

    const { rows } = await query(sql, params);

    const items = rows.map(r => ({
      id: r.id, type: r.type, title: r.title, body: r.body,
      target: r.target, priority: r.priority, isPopup: r.is_popup,
      imageUrl: r.image_url, link: r.link, status: r.status,
      authorId: r.author_id, pinned: r.pinned,
      createdAt: r.created_at, updatedAt: r.updated_at,
    }));

    return NextResponse.json({ items });
  } catch (err) {
    console.error('[announcements GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
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
