// ── /api/v1/feedback/[id]/comments ───────────────────────────────────────
// GET   — list comments on a request, oldest-first.
// POST  — append a comment. Anyone authenticated can comment; the server
//          stamps author_id / author_email / author_name from the JWT so
//          the row is durable even if the user's display name changes.
// ─────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { query } from '../../../../../../src/lib/db';

function shape(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    authorId: row.author_id,
    authorEmail: row.author_email,
    authorName: row.author_name,
    body: row.body,
    createdAt: row.created_at,
  };
}

export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const { rows } = await query(
      'SELECT * FROM feedback_comments WHERE request_id = $1 ORDER BY created_at ASC',
      [id],
    );
    return NextResponse.json({ items: rows.map(shape) });
  } catch (err) {
    console.error('[feedback/comments/list]', err.message);
    return NextResponse.json({ error: 'Failed to load comments' }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) return NextResponse.json({ error: 'body is required' }, { status: 400 });

  try {
    // Make sure the parent exists — saves a phantom comment + ON CASCADE will
    // drop orphans later if the parent disappears.
    const parent = await query('SELECT 1 FROM feedback_requests WHERE id = $1', [id]);
    if (parent.rowCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { rows } = await query(
      `INSERT INTO feedback_comments (request_id, author_id, author_email, author_name, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, user.id || null, user.email, user.name || null, text.slice(0, 8000)],
    );
    // Bump parent updated_at so the comment activity surfaces in
    // "recently_updated" sort.
    await query('UPDATE feedback_requests SET updated_at = NOW() WHERE id = $1', [id]);
    return NextResponse.json({ item: shape(rows[0]) }, { status: 201 });
  } catch (err) {
    console.error('[feedback/comments/create]', err.message);
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 });
  }
}
