import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { canApproveAnnouncementRequests } from '../../../../../../src/lib/announcements-admin';
import { recordAudit } from '../../../../../../src/lib/announcementFlow';

// POST /api/v1/announcement-requests/:id/request-info
//   Body: { question: string }
//   Approver-only. Transitions request to 'needs_info' and posts the
//   question as a comment so the requester can reply in-thread.
export async function POST(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!(await canApproveAnnouncementRequests(user))) {
      return NextResponse.json({ error: 'Only approvers can ask for clarification' }, { status: 403 });
    }
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const question = (body.question || '').toString().trim();
    if (!question) return NextResponse.json({ error: 'Question required' }, { status: 400 });

    const { rows: existing } = await query(
      `SELECT status FROM announcement_requests WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (existing.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!['pending', 'needs_info'].includes(existing[0].status)) {
      return NextResponse.json({ error: `Cannot request info on ${existing[0].status} request` }, { status: 400 });
    }

    await query(
      `UPDATE announcement_requests SET status = 'needs_info', updated_at = NOW() WHERE id = $1`,
      [id]
    );
    await query(
      `INSERT INTO announcement_request_comments
         (request_id, author_id, author_email, author_name, body)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, user.id || null, user.email, user.name || null, question]
    );
    await recordAudit(id, user, 'requested_info', { length: question.length });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[announcement-requests/request-info]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
