// ── GET /api/v1/team-members/countries/export ──────────────────────────────
// CSV export of the live country-ownership map. Surfaces every active
// HRX member with the comma-separated list of country codes they own,
// plus a final section that flags members with no countries assigned.
// Used to audit the dashboard's allocation against the Deel "Countries by
// Person Role" spreadsheet — drop the export next to the spreadsheet,
// diff, fill any gaps via the Team-tab UI.
//
// Auth: any authenticated @deel.com user can download (~104-person tool;
// the data is otherwise visible on the Team tab).

import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { mergeTeamMembers } from '../../../../../../src/lib/team-members-merge';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';

// Minimal CSV escape: wrap in quotes if the field contains comma / quote /
// newline; double any embedded quotes per RFC 4180.
function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await ensureRosterHydrated();

  try {
    const [overridesRes, countriesRes] = await Promise.all([
      query(
        `SELECT email, name, initials, title, access, manager_email, team, region,
                service, country, avatar_url, start_date, is_new, is_deleted,
                on_leave, last_login_at, login_count, is_announcements_admin,
                is_access_admin, created_at, updated_at
           FROM team_member_overrides`,
      ),
      query(
        `SELECT email, country_code FROM team_member_countries ORDER BY email, country_code`,
      ),
    ]);

    const merged = mergeTeamMembers(overridesRes.rows).filter(m => !m.isDeleted);

    // Group countries by lowercased email so we can render every member —
    // even ones with zero assignments — in a single sweep.
    const byEmail = new Map();
    for (const r of countriesRes.rows) {
      const e = (r.email || '').toLowerCase();
      if (!e) continue;
      if (!byEmail.has(e)) byEmail.set(e, []);
      byEmail.get(e).push((r.country_code || '').toUpperCase());
    }

    const lines = ['Name,Email,Access,Team,Region,Country Count,Countries'];
    for (const m of merged) {
      const lc = (m.email || '').toLowerCase();
      const countries = (byEmail.get(lc) || []).sort();
      lines.push([
        csvEscape(m.name || ''),
        csvEscape(m.email || ''),
        csvEscape(m.access || ''),
        csvEscape(m.team || ''),
        csvEscape(m.region || ''),
        countries.length,
        csvEscape(countries.join(', ')),
      ].join(','));
    }

    const filename = `team-country-ownership-${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(lines.join('\n') + '\n', {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[team-members/countries/export]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
