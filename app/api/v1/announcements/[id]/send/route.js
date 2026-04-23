import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { isApprover } from '../../../../../../src/data/approvers';
import { checkPublishingRules } from '../../../../../../src/lib/announcementFlow';

// PATCH /api/v1/announcements/:id/send — flip a draft to 'sent'.
// Enforces the 2/day + 4h-gap publishing rules. Approvers may skip them
// via ?urgent=1 (passed as a query param to keep signature stable).
export async function PATCH(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const approver = isApprover(user.email);
    const allowedRoles = ['admin', 'regional_manager', 'manager', 'team_lead'];
    if (!approver && !allowedRoles.includes(user.role)) {
      return NextResponse.json({ error: 'Only managers/approvers can publish announcements' }, { status: 403 });
    }

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const urgentOverride = approver && searchParams.get('urgent') === '1';

    if (!urgentOverride) {
      const check = await checkPublishingRules(new Date());
      if (!check.ok) {
        return NextResponse.json({ error: check.reason, code: 'RATE_LIMIT' }, { status: 409 });
      }
    }

    const { rows } = await query(
      `UPDATE announcements
          SET status = 'sent',
              sent_at = COALESCE(sent_at, NOW()),
              scheduled_for = NULL,
              updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [id]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[announcements/send]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
