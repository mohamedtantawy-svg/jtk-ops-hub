// ── /api/v1/settings/team-lead-on-call ──────────────────────────────────
// Mirror of /settings/manager-on-call for the second rotating role
// (Mohamed 2026-05-14 spec). PUT additionally performs a bulk
// reassignment of auto-assigned HR-Hub rows from the previous TLOC to
// the new one — preserving manually-changed assignees.
//
// Why the side effect lives on PUT (and not a separate route):
//   • The TLOC rotation IS the trigger for the bulk reassignment. Doing
//     it inline keeps the operation atomic — there's no window where
//     the settings row says "Alice" but the requests still point at
//     "Bob".
//   • The query is cheap thanks to the partial index
//     `idx_hr_hub_request_auto_assign` (only un-manually-set rows are
//     scanned, filtered by flow+assignee_email).

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { cacheGet, cacheSet, cacheDel } from '../../../../../src/lib/server-cache';

const CACHE_KEY = 'team_lead_on_call';
const CACHE_TTL = 5000;

// No DEFAULT — empty until set by an admin/TL. The FE renders the pill
// only when a TLOC is present, so an unset state simply means "no
// auto-routing for HR Requests / Reporting" (assignee defaults back to
// null on create, behaving exactly as before this feature shipped).
const DEFAULT_TLOC = null;

async function getDb() {
  if (!process.env.DATABASE_URL) return null;
  const { query, withTransaction } = await import('../../../../../src/lib/db');
  return { query, withTransaction };
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // cacheGet returns null on miss/expiry — match the MOC route's truthy
  // check so a stale `null` doesn't shadow the DB read and erase the
  // current TLOC on the FE side. The previous `!== undefined` predicate
  // was always true (cacheGet never returns undefined), causing every
  // refresh after the 5s TTL to short-circuit with `null` and the FE
  // pill to revert to empty.
  const cached = cacheGet(CACHE_KEY, CACHE_TTL);
  if (cached) return NextResponse.json(cached);

  const db = await getDb();
  if (db) {
    try {
      const { rows } = await db.query("SELECT value, updated_by, updated_at FROM app_settings WHERE key = 'team_lead_on_call'");
      if (rows.length > 0 && rows[0].value) {
        const result = { ...rows[0].value, updatedBy: rows[0].updated_by, updatedAt: rows[0].updated_at };
        cacheSet(CACHE_KEY, result);
        return NextResponse.json(result);
      }
    } catch (err) {
      console.warn('[team-lead-on-call] DB read failed:', err.message);
    }
  }
  // Cache the null result too so we don't hammer the DB on every poll
  // before any TLOC has been set.
  cacheSet(CACHE_KEY, DEFAULT_TLOC);
  return NextResponse.json(DEFAULT_TLOC);
}

export async function PUT(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { name, email, initials, avatarUrl } = body;
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const value = {
    name,
    email: (email || '').toLowerCase(),
    initials: initials || name.split(' ').map(w => w[0]?.toUpperCase()).slice(0, 2).join(''),
    avatarUrl: avatarUrl || '',
  };

  const db = await getDb();
  let reassignedCount = 0;
  let previousTlocEmail = null;

  if (db) {
    try {
      // Run the settings write + bulk reassignment in one txn so the
      // settings row and the request rows never disagree.
      await db.withTransaction(async (client) => {
        // Capture the previous TLOC email so the bulk reassign only
        // touches rows previously routed to them. The row might not
        // exist yet on first-set; treat missing as null.
        const { rows: prev } = await client.query(
          "SELECT value FROM app_settings WHERE key = 'team_lead_on_call' FOR UPDATE",
        );
        previousTlocEmail = prev.length > 0 ? (prev[0].value?.email || '').toLowerCase() || null : null;

        await client.query(
          `INSERT INTO app_settings (key, value, updated_by, updated_at)
           VALUES ('team_lead_on_call', $1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = NOW()`,
          [JSON.stringify(value), user.email],
        );

        // Bulk-reassign every auto-routed HR Request / HR Reporting row
        // to the new TLOC — not just rows previously assigned to the
        // previous TLOC. The narrower "from prev → new" version left
        // behind rows with NULL or stale assignees (pre-feature rows,
        // rows created during a brief no-TLOC window) so the user could
        // still see un-routed work in their queue. Skip:
        //   • Manually re-assigned rows (assignee_manually_set = TRUE).
        //   • Already-resolved or rejected rows.
        //   • Rows already correctly pointing at the new TLOC.
        //   • The case where the previous TLOC is the new TLOC (no-op).
        if (value.email && previousTlocEmail !== value.email) {
          const { rowCount } = await client.query(
            `UPDATE hr_hub_request
                SET assignee_email = $1,
                    assignee_name  = $2,
                    updated_at     = NOW()
              WHERE flow IN ('hr_request', 'hr_reporting')
                AND assignee_manually_set = FALSE
                AND status NOT IN ('resolved', 'rejected')
                AND LOWER(COALESCE(assignee_email, '')) IS DISTINCT FROM $1`,
            [value.email, value.name],
          );
          reassignedCount = rowCount || 0;
        }
      });
    } catch (err) {
      console.error('[team-lead-on-call] DB write / reassign failed:', err.message);
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
    }
  }

  // Bust caches so the next FE poll picks up the new TLOC + reassigned
  // rows on the very next /me / hr-hub list cycle (otherwise the 5s
  // settings cache + 30s server cache windows would hide the change).
  cacheDel(CACHE_KEY);
  // The HR Hub list is paged + cursor-based with no server cache, so no
  // explicit cacheDel needed for it.

  const result = {
    ...value,
    updatedBy: user.email,
    updatedAt: new Date().toISOString(),
    reassignedCount,
    previousEmail: previousTlocEmail,
  };
  cacheSet(CACHE_KEY, result);
  return NextResponse.json(result);
}
