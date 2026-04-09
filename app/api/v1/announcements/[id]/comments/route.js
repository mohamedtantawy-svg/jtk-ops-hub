import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const { rows } = await query(
      'SELECT * FROM announcement_comments WHERE announcement_id = $1 ORDER BY created_at ASC',
      [id]
    );
    const items = rows.map(r => ({
      id: r.id, announcementId: r.announcement_id, authorId: r.author_id,
      authorName: r.author_name, body: r.body, parentId: r.parent_id,
      createdAt: r.created_at,
    }));
    return NextResponse.json({ items });
  } catch (err) {
    console.error('[comments GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  try {
    const { id } = await params;
    const { body, parentId } = await req.json();
    if (!body) return NextResponse.json({ error: 'Body required' }, { status: 400 });

    const { rows } = await query(
      'INSERT INTO announcement_comments (announcement_id, body, parent_id, author_name) VALUES ($1, $2, $3, $4) RETURNING *',
      [id, body, parentId || null, 'User']
    );
    const r = rows[0];
    return NextResponse.json({
      id: r.id, body: r.body, parentId: r.parent_id, createdAt: r.created_at,
    }, { status: 201 });
  } catch (err) {
    console.error('[comments POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
