// ── GET /api/v1/time-off-import-batches ───────────────────────────────
// Admin-only — last N import batches for the Settings panel audit
// surface. HANDOVERS_PLAN.md §14 surfaces this as one of the audit
// pillars so operators can answer "did the v3 reimport actually land?"
// without grepping the DB.

import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { canManageHandoverSettings } from '../../../../src/lib/handover-admin';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManageHandoverSettings(user))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const { rows } = await query(
      `SELECT id, source, filename, uploaded_by_email,
              rows_total, rows_inserted, rows_skipped, rows_invalid,
              uploaded_at
         FROM time_off_import_batches
        ORDER BY uploaded_at DESC
        LIMIT 25`,
    );
    return NextResponse.json({ items: rows });
  } catch (err) {
    console.error('[time-off-import-batches GET]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
