import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const { rows } = await query(
      `SELECT al.*, a.title, a.type FROM announcement_links al
       JOIN announcements a ON a.id = al.target_id
       WHERE al.source_id = $1 ORDER BY al.created_at DESC`,
      [id]
    );
    const items = rows.map(r => ({
      id: r.id, targetId: r.target_id, title: r.title, type: r.type,
    }));
    return NextResponse.json({ items });
  } catch (err) {
    console.error('[links GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  try {
    const { id } = await params;
    const { targetId } = await req.json();
    if (!targetId) return NextResponse.json({ error: 'targetId required' }, { status: 400 });

    await query(
      'INSERT INTO announcement_links (source_id, target_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [id, targetId]
    );
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error('[links POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
