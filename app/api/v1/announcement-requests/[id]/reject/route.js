import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { isApprover } from '../../../../../../src/data/approvers';
import { recordAudit } from '../../../../../../src/lib/announcementFlow';

// POST /api/v1/announcement-requests/:id/reject
//   Body: { reason: string }
//   Approver only. Requester can resubmit a new request with corrections
//   (no edit-then-resubmit because rejection is terminal for this row).
export async function POST(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isApprover(user.email)) {
      return NextResponse.json({ error: 'Only approvers can reject requests' }, { status: 403 });
    }
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const reason = (body.reason || '').toString().trim();
    if (!reason) {
      return NextResponse.json({ error: 'Rejection reason required' }, { status: 400 });
    }

    const { rows: existing } = await query(
      `SELECT status FROM announcement_requests WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (existing.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!['pending', 'needs_info'].includes(existing[0].status)) {
      return NextResponse.json({ error: `Cannot reject a ${existing[0].status} request` }, { status: 400 });
    }

    await query(
      `UPDATE announcement_requests SET
         status = 'rejected',
         rejection_reason = $1,
         decided_by_id = $2, decided_by_email = $3, decided_by_name = $4,
         decided_at = NOW(),
         updated_at = NOW()
       WHERE id = $5`,
      [reason, user.id || null, user.email, user.name || null, id]
    );
    await recordAudit(id, user, 'rejected', { reason });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[announcement-requests/reject]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
