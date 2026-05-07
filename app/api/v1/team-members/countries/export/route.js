// ── GET /api/v1/team-members/countries/export ──────────────────────────────
// CSV export of the live country-ownership map. One row per active HRX
// member with the comma-separated list of ISO codes they own. Members
// with zero assignments still appear (Country Count = 0) so a glance at
// the column reveals every gap.
//
// Used to audit the dashboard's allocation against the Deel "Countries by
// Person Role" spreadsheet — sort the export by Country Count ascending
// and the unassigned bubble to the top.
//
// Format hardening (2026-04-30):
//   • UTF-8 BOM prefix so Excel on Windows recognises the encoding and
//     doesn't mangle accented names ("María" → "MarÃ­a").
//   • CRLF line endings per RFC 4180 — the older LF-only output broke
//     a couple of older CSV parsers and Numbers' import wizard.
//   • Always-quoted fields so leading-zero codes ("AT", "AU") and
//     comma-bearing names round-trip cleanly.
//   • ASCII-safe filename in Content-Disposition so Safari doesn't drop
//     the header when the date contains characters its parser dislikes.
//
// Auth: any authenticated @deel.com user can download (~104-person tool;
// the same data is otherwise visible on the Team tab).

import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { mergeTeamMembers } from '../../../../../../src/lib/team-members-merge';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';

// Always quote per RFC 4180. Doubles any embedded quotes.
function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

// Strip everything that isn't safe in a Content-Disposition filename
// param. Browsers vary in tolerance; ASCII alnum + . _ - is universal.
function safeFilename(s) {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_');
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await ensureRosterHydrated();

  try {
    const [overridesRes, countriesRes, loginsRes] = await Promise.all([
      query(
        `SELECT email, name, initials, title, access, manager_email, team, region,
                service, country, avatar_url, start_date, is_new, is_deleted,
                on_leave, is_announcements_admin,
                is_access_admin, created_at, updated_at
           FROM team_member_overrides`,
      ),
      query(
        `SELECT email, country_code FROM team_member_countries ORDER BY email, country_code`,
      ).catch(err => {
        // Table missing on a brand-new env (migration hasn't completed)
        // OR a transient DB error. Either way we serve the export with
        // empty country counts rather than 500-ing the entire download.
        console.warn('[team-members/countries/export] countries query failed:', err?.message);
        return { rows: [] };
      }),
      query(
        `SELECT email, last_seen_at, last_login_at, login_count FROM member_logins`,
      ).catch(err => {
        console.warn('[team-members/countries/export] member_logins query failed:', err?.message);
        return { rows: [] };
      }),
    ]);

    const merged = mergeTeamMembers(overridesRes.rows, loginsRes.rows).filter(m => !m.isDeleted);

    // Group countries by lowercased email so we can render every member —
    // even ones with zero assignments — in a single sweep.
    const byEmail = new Map();
    for (const r of countriesRes.rows) {
      const e = (r.email || '').toLowerCase();
      if (!e) continue;
      if (!byEmail.has(e)) byEmail.set(e, []);
      byEmail.get(e).push((r.country_code || '').toUpperCase());
    }

    // Build rows; sort by ascending count so unassigned members surface at
    // the top of the spreadsheet — that's the audit signal the user is
    // looking for ("who's missing countries?").
    const rows = merged.map(m => {
      const lc = (m.email || '').toLowerCase();
      const countries = (byEmail.get(lc) || []).slice().sort();
      return {
        name: m.name || '',
        email: m.email || '',
        access: m.access || '',
        team: m.team || '',
        region: m.region || '',
        countryCount: countries.length,
        countries: countries.join(', '),
      };
    });
    rows.sort((a, b) => {
      // Unassigned first; within the same count, alphabetical by name so
      // diffs against the Deel spreadsheet are stable.
      if (a.countryCount !== b.countryCount) return a.countryCount - b.countryCount;
      return a.name.localeCompare(b.name);
    });

    const HEADER = ['Name', 'Email', 'Access', 'Team', 'Region', 'Country Count', 'Countries'];
    const csvLines = [HEADER.map(csvEscape).join(',')];
    for (const r of rows) {
      csvLines.push([
        csvEscape(r.name),
        csvEscape(r.email),
        csvEscape(r.access),
        csvEscape(r.team),
        csvEscape(r.region),
        csvEscape(String(r.countryCount)),
        csvEscape(r.countries),
      ].join(','));
    }

    // ﻿ is the UTF-8 BOM. Excel needs it; everything else ignores it.
    // CRLF line endings per RFC 4180.
    const body = '﻿' + csvLines.join('\r\n') + '\r\n';
    const date = new Date().toISOString().slice(0, 10);
    const filename = safeFilename(`team-country-ownership-${date}.csv`);

    return new NextResponse(body, {
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
