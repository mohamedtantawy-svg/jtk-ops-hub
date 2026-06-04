// ── /api/v1/settings/team-lead-on-call ──────────────────────────────────
// Mirror of /settings/manager-on-call for the second rotating role
// (Mohamed 2026-05-14 spec). Per-department (Mohamed 2026-06-04): storage +
// the HRX-inheritance rule live in src/lib/dept-settings.js; this route reads/
// writes `team_lead_on_call:<deptId>`. PUT additionally bulk-reassigns the
// dept's auto-assigned HR-Hub rows from the previous TLOC to the new one —
// preserving manually-changed assignees AND scoped to this dept so rotating
// one dept's TLOC never touches another dept's requests.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { getCurrentDeptSlugAndId } from '../../../../../src/lib/dept-scope';
import { deptSettingKey, readDeptSettingRow } from '../../../../../src/lib/dept-settings';
import { cacheGet, cacheSet, cacheDel } from '../../../../../src/lib/server-cache';

const BASE_KEY = 'team_lead_on_call';
const CACHE_TTL = 5000;

// No DEFAULT — empty until set. The FE renders the pill only when a TLOC is
// present, so an unset state means "no auto-routing for HR Requests /
// Reporting" (assignee defaults back to null on create).
const DEFAULT_TLOC = null;

async function getDb() {
  if (!process.env.DATABASE_URL) return null;
  const { query, withTransaction } = await import('../../../../../src/lib/db');
  return { query, withTransaction };
}

async function resolveScope(user, req) {
  const scope = await getCurrentDeptSlugAndId(user, req).catch(() => null);
  const deptId = scope?.deptId || null;
  return { deptId, deptSlug: scope?.deptSlug || null, key: deptSettingKey(BASE_KEY, deptId) };
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { deptId, deptSlug, key } = await resolveScope(user, req);

  // cacheGet returns null on miss/expiry — truthy check so a stale `null`
  // doesn't shadow the DB read and erase the current TLOC on the FE side.
  const cached = cacheGet(key, CACHE_TTL);
  if (cached) return NextResponse.json(cached);

  try {
    const row = await readDeptSettingRow(BASE_KEY, deptId, deptSlug);
    if (row && row.value) {
      const result = { ...row.value, updatedBy: row.updated_by, updatedAt: row.updated_at };
      cacheSet(key, result);
      return NextResponse.json(result);
    }
  } catch (err) {
    console.warn('[team-lead-on-call] DB read failed:', err.message);
  }
  // Cache the null result too so we don't hammer the DB on every poll
  // before any TLOC has been set for this dept.
  cacheSet(key, DEFAULT_TLOC);
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

  const { key, deptId } = await resolveScope(user, req);

  const db = await getDb();
  let reassignedCount = 0;
  let previousTlocEmail = null;

  if (db) {
    try {
      // Settings write + bulk reassignment in one txn so the settings row and
      // the request rows never disagree.
      await db.withTransaction(async (client) => {
        // Previous TLOC for this dept — used by the no-op guard below.
        const { rows: prev } = await client.query(
          'SELECT value FROM app_settings WHERE key = $1 FOR UPDATE',
          [key],
        );
        previousTlocEmail = prev.length > 0 ? (prev[0].value?.email || '').toLowerCase() || null : null;

        await client.query(
          `INSERT INTO app_settings (key, value, updated_by, updated_at)
           VALUES ($3, $1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = NOW()`,
          [JSON.stringify(value), user.email, key],
        );

        // Bulk-reassign every auto-routed HR Request / HR Reporting row IN
        // THIS DEPT to the new TLOC. Skip:
        //   • Manually re-assigned rows (assignee_manually_set = TRUE).
        //   • Already-resolved or rejected rows.
        //   • Rows already pointing at the new TLOC.
        //   • previous TLOC == new TLOC (no-op).
        //   • Other departments' rows (org_node_id filter) — rotating GIX's
        //     TLOC must never reassign HRX's requests.
        if (value.email && previousTlocEmail !== value.email && deptId) {
          const { rowCount } = await client.query(
            `UPDATE hr_hub_request
                SET assignee_email = $1,
                    assignee_name  = $2,
                    updated_at     = NOW()
              WHERE flow IN ('hr_request', 'hr_reporting')
                AND assignee_manually_set = FALSE
                AND status NOT IN ('resolved', 'rejected')
                AND org_node_id = $3
                AND LOWER(COALESCE(assignee_email, '')) IS DISTINCT FROM $1`,
            [value.email, value.name, deptId],
          );
          reassignedCount = rowCount || 0;
        }
      });
    } catch (err) {
      console.error('[team-lead-on-call] DB write / reassign failed:', err.message);
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
    }
  }

  // Bust this dept's cache so the next FE poll picks up the new TLOC.
  cacheDel(key);

  const result = {
    ...value,
    updatedBy: user.email,
    updatedAt: new Date().toISOString(),
    reassignedCount,
    previousEmail: previousTlocEmail,
  };
  cacheSet(key, result);
  return NextResponse.json(result);
}
