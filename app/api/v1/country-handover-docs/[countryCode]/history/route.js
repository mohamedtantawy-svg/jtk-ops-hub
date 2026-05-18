// ── GET /api/v1/country-handover-docs/:countryCode/history ─────────────────
// Audit trail for a country handover doc. History entries can carry
// sensitive context (stakeholder emails, internal notes), so the read
// gate matches PATCH — only country owners / HR Hub admins / admins.
//
// Response shape (newest first, capped at 50):
//   { items: [{ id, edited_by_email, edited_at, changed_fields: [...],
//               diff, comment }] }
//
// The FE's history pane renders changed_fields inline; the full diff is
// returned so a per-row expand can show before/after without a second
// request.

import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import {
  canEditCountryHandoverDoc,
  normaliseCountryCode,
  isValidCountryCode,
} from '../../../../../../src/lib/country-handover-docs';

const PAGE_LIMIT = 50;

export async function GET(req, ctx) {
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
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { rows } = await query(
      `SELECT h.id, h.doc_id, h.country_code, h.edited_by_email, h.edited_at,
              h.diff, h.comment
         FROM country_handover_doc_history h
         JOIN country_handover_docs d ON d.id = h.doc_id
        WHERE d.country_code = $1
        ORDER BY h.edited_at DESC
        LIMIT $2`,
      [cc, PAGE_LIMIT],
    );

    const items = rows.map(r => ({
      id: r.id,
      edited_by_email: r.edited_by_email,
      edited_at: r.edited_at instanceof Date ? r.edited_at.toISOString() : r.edited_at,
      changed_fields: r.diff ? Object.keys(r.diff) : [],
      diff: r.diff || {},
      comment: r.comment,
    }));

    return NextResponse.json({ items, total: items.length });
  } catch (err) {
    console.error('[country-handover-docs/:cc/history GET]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
