// ── POST /api/v1/country-handover-docs/:countryCode/publish ────────────────
// Flips a doc from 'draft' → 'published' (or republishes a previously
// unpublished doc). Edit gates apply — only country owners / HR Hub
// admins / admins can publish.
//
// Body is optional; { unpublish: true } flips status back to 'draft' so
// the Phase B editor can hide the doc again. The audit log records each
// flip with a status-only diff so the history pane shows publication
// events alongside content edits.

import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import {
  canEditCountryHandoverDoc,
  writeHistory,
  rowToDoc,
  normaliseCountryCode,
  isValidCountryCode,
} from '../../../../../../src/lib/country-handover-docs';

export async function POST(req, ctx) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { countryCode: raw } = await ctx.params;
  if (!isValidCountryCode(raw)) {
    return NextResponse.json({ error: 'Invalid country code' }, { status: 400 });
  }
  const cc = normaliseCountryCode(raw);

  await ensureRosterHydrated();

  if (!(await canEditCountryHandoverDoc(user, cc))) {
    return NextResponse.json({ error: 'Forbidden — only country owners or HR Hub admins can publish this doc.' }, { status: 403 });
  }

  let body = {};
  try { body = await req.json(); }
  catch { /* empty body is fine */ }
  const targetStatus = body?.unpublish === true ? 'draft' : 'published';

  try {
    const before = await query(
      `SELECT id, status FROM country_handover_docs WHERE country_code = $1`,
      [cc],
    );
    const beforeRow = before.rows[0];
    if (!beforeRow) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (beforeRow.status === targetStatus) {
      // Already in the target state — return the row with a no-op flag.
      const { rows } = await query(
        `SELECT * FROM country_handover_docs WHERE country_code = $1`,
        [cc],
      );
      return NextResponse.json({ item: rowToDoc(rows[0]), updated: 0 });
    }

    const { rows } = await query(
      `UPDATE country_handover_docs
          SET status = $1,
              updated_at = NOW(),
              updated_by_email = $2
        WHERE country_code = $3
        RETURNING *`,
      [targetStatus, user.email, cc],
    );
    const after = rows[0];

    await writeHistory({
      docId: after.id,
      countryCode: cc,
      editorEmail: user.email,
      diff: { status: { from: beforeRow.status, to: targetStatus } },
      comment: targetStatus === 'published' ? 'Published' : 'Unpublished',
    });

    return NextResponse.json({ item: rowToDoc(after), updated: 1 });
  } catch (err) {
    console.error('[country-handover-docs/:cc/publish POST]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
