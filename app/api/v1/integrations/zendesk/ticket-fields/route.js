// ── GET /api/v1/integrations/zendesk/ticket-fields ───────────────────────────
// Returns metadata for the 4 ops-hub-tracked Zendesk custom fields:
//   employeeCountry / form / rootCauseSupport / rootCauseSelector
//
// Each entry is either { id, title, type, options[] } or null if the field
// doesn't exist in Zendesk under the expected title. The FE uses this once
// per Detail mount to render select boxes; the queue route uses the same
// resolution to surface per-ticket values.
//
// Cached server-side for 1 hour (see src/lib/zendesk-fields.js).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { isZendeskConfigured } from '../../../../../../src/lib/zendesk-api';
import { resolveCustomFieldIds } from '../../../../../../src/lib/zendesk-fields';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isZendeskConfigured()) {
    return NextResponse.json({ error: 'Zendesk API not configured' }, { status: 503 });
  }

  // ?force=1 lets admins/devs bust the in-process cache when an option set
  // was edited in Zendesk and they want it visible immediately. No auth
  // gate beyond the standard session check — discovery returns metadata,
  // not ticket data.
  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1';

  try {
    const fields = await resolveCustomFieldIds({ force });
    return NextResponse.json({ fields });
  } catch (err) {
    console.error('[integrations/zendesk/ticket-fields]', err.message);
    return NextResponse.json({ error: 'Field discovery failed' }, { status: 500 });
  }
}
