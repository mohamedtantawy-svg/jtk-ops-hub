import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { canApproveAnnouncementRequests } from '../../../../../../src/lib/announcements-admin';
import { recordAudit } from '../../../../../../src/lib/announcementFlow';

// GET /api/v1/announcement-requests/:id/comments — visible to requester + approvers
export async function GET(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    const { rows: existing } = await query(
      `SELECT requested_by_email FROM announcement_requests WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (existing.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const isRequester = String(existing[0].requested_by_email || '').toLowerCase() === user.email.toLowerCase();
    if (!isRequester && !(await canApproveAnnouncementRequests(user))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { rows } = await query(
      `SELECT id, author_id, author_email, author_name, body, created_at
         FROM announcement_request_comments WHERE request_id = $1 ORDER BY created_at ASC`,
      [id]
    );
    // Splice emoji reactions onto each comment (Sarah Suge 2026-05-14).
    let reactionMap = new Map();
    if (rows.length > 0) {
      const { fetchReactionsForComments } = await import('../../../../../../src/lib/comment-reactions-helpers');
      reactionMap = await fetchReactionsForComments('announcement_request', rows.map(c => c.id));
    }
    return NextResponse.json({
      items: rows.map((c) => ({
        id: c.id,
        authorId: c.author_id,
        authorEmail: c.author_email,
        authorName: c.author_name,
        body: c.body,
        createdAt: c.created_at,
        reactions: reactionMap.get(String(c.id)) || [],
      })),
    });
  } catch (err) {
    console.error('[announcement-requests/comments GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// POST /api/v1/announcement-requests/:id/comments — add a clarification note
export async function POST(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const { body } = await req.json().catch(() => ({}));
    const text = (body || '').toString().trim();
    if (!text) return NextResponse.json({ error: 'Comment body required' }, { status: 400 });

    const { rows: existing } = await query(
      `SELECT requested_by_email FROM announcement_requests WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (existing.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const isRequester = String(existing[0].requested_by_email || '').toLowerCase() === user.email.toLowerCase();
    if (!isRequester && !(await canApproveAnnouncementRequests(user))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { rows } = await query(
      `INSERT INTO announcement_request_comments
         (request_id, author_id, author_email, author_name, body)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [id, user.id || null, user.email, user.name || null, text]
    );
    await recordAudit(id, user, 'comment_added', { length: text.length });

    return NextResponse.json({
      id: rows[0].id,
      createdAt: rows[0].created_at,
    }, { status: 201 });
  } catch (err) {
    console.error('[announcement-requests/comments POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
