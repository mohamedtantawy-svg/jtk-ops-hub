// ── GET / PUT /api/v1/team-members/:email/countries ─────────────────────────
// Per-member country ownership. The Queue's country-OR-assignee scoping
// reads the resulting Map<email, Set<CC>> when classifying onboarding /
// paused-onboarding / offboarding / amendments / redlines rows. PUT
// replaces the full set in one transaction so partial-write edge cases
// (e.g. tab close mid-save) can't leave a member with half-applied
// changes.
//
// Auth: any authed user can GET (public roster). PUT requires admin,
// regional_manager, team_lead, OR a per-user is_access_admin grant — the
// same surface as the rest of the Team tab's allocation editor.

import { NextResponse } from 'next/server';
import { query, getPool } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import {
  invalidateRosterCache,
  ensureRosterHydrated,
} from '../../../../../../src/lib/roster-server';
import { isAccessAdmin } from '../../../../../../src/lib/access-admin';
import { TEAM_MEMBERS } from '../../../../../../src/data/members';

const ALLOWED_ACCESS = new Set(['admin', 'regional_manager', 'team_lead']);

async function canEditCountries(user) {
  if (!user?.email) return false;
  if (user.role && ALLOWED_ACCESS.has(String(user.role).toLowerCase())) return true;
  const baseline = TEAM_MEMBERS.find(m => m.email.toLowerCase() === user.email.toLowerCase());
  if (baseline && ALLOWED_ACCESS.has((baseline.access || '').toLowerCase())) return true;
  return await isAccessAdmin(user.email);
}

function lowerEmailParam(p) {
  if (!p) return '';
  try {
    return decodeURIComponent(p).toLowerCase();
  } catch {
    return String(p).toLowerCase();
  }
}

export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const email = lowerEmailParam((await params).email);
  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }
  try {
    const { rows } = await query(
      `SELECT country_code FROM team_member_countries WHERE LOWER(email) = $1
        ORDER BY country_code`,
      [email],
    );
    const countries = rows.map(r => (r.country_code || '').toUpperCase()).filter(Boolean);
    return NextResponse.json({ email, countries });
  } catch (err) {
    console.error('[team-members/countries GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!(await canEditCountries(user))) {
    return NextResponse.json({
      error: 'Only Team Leads, Regional Managers, Admins, and Access Admins can edit country ownership',
    }, { status: 403 });
  }

  const email = lowerEmailParam((await params).email);
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }

  let body;
  try { body = await req.json(); } catch { body = null; }
  if (!body || !Array.isArray(body.countries)) {
    return NextResponse.json({ error: 'Body must include `countries` array' }, { status: 400 });
  }

  // Normalise: uppercase ISO 2-letter codes, dedupe, drop blanks. Cap at
  // 200 entries as a sanity guard so a runaway client can't blow up the
  // junction table.
  const cleaned = Array.from(new Set(
    body.countries
      .map(c => (typeof c === 'string' ? c.trim().toUpperCase() : ''))
      .filter(c => /^[A-Z]{2}$/.test(c)),
  )).slice(0, 200);

  // Replace the set in a single transaction: DELETE then INSERT. This is
  // simpler than diffing additions vs. removals and means the read-after-
  // write returns exactly what the caller asked for.
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM team_member_countries WHERE LOWER(email) = $1',
      [email],
    );
    if (cleaned.length > 0) {
      const valuesSql = cleaned.map((_, i) => `($1, $${i + 2})`).join(', ');
      await client.query(
        `INSERT INTO team_member_countries (email, country_code) VALUES ${valuesSql}
          ON CONFLICT (email, country_code) DO NOTHING`,
        [email, ...cleaned],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[team-members/countries PUT]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  } finally {
    client.release();
  }

  // Bust the roster cache + rehydrate now so the next scoped queue request
  // (within ~5s) picks up the new map. Without this, an Agent's queue would
  // continue showing the old country set until the natural TTL.
  invalidateRosterCache();
  await ensureRosterHydrated({ force: true });

  return NextResponse.json({ email, countries: cleaned });
}
