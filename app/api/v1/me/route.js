import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../src/lib/auth-helpers';

export async function GET(req) {
  try {
    const authUser = getAuthUser(req);
    if (!authUser.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Try DB lookup first
    let dbUser = null;
    try {
      if (process.env.DATABASE_URL) {
        const { query } = await import('../../../../src/lib/db');

        // Belt-and-braces: run the scheduled-announcements promotion loop
        // opportunistically so that even quiet tabs (with nobody actively
        // loading the announcement-requests list) keep the publishing
        // pipeline moving. /me is called on session revalidation and
        // occasional auth checks.
        try {
          const { promoteDueScheduled } = await import('../../../../src/lib/announcementFlow');
          await promoteDueScheduled();
        } catch (e) {
          // Non-fatal — promotion will retry on the next hot endpoint.
          console.warn('[me] promoteDueScheduled failed:', e.message);
        }

        const { rows } = await query(
          'SELECT id, name, initials, role, team, region, country, lead_id, email, avatar_url, is_active, created_at, updated_at FROM members WHERE email = $1',
          [authUser.email]
        );
        if (rows.length > 0) dbUser = rows[0];

        // Fall back to team_member_overrides for users who were added via the
        // Team tab but never had a members row seeded (e.g. new hires created
        // after the initial seed). Prevents /me from returning team=null for
        // them, which would break permissions + Home/Team-Summary filters.
        if (!dbUser) {
          try {
            const { rows: ovRows } = await query(
              `SELECT email, name, initials, access, team, region, country, avatar_url, manager_email
                 FROM team_member_overrides
                WHERE email = $1 AND (is_deleted IS NULL OR is_deleted = false)`,
              [authUser.email]
            );
            if (ovRows.length > 0) {
              const o = ovRows[0];
              dbUser = {
                id: 0,
                name: o.name || authUser.name || authUser.email,
                initials: o.initials,
                role: o.access || 'agent',
                team: o.team,
                region: o.region,
                country: o.country,
                lead_id: null,
                email: o.email,
                avatar_url: o.avatar_url,
                is_active: true,
                created_at: null,
                updated_at: null,
              };
            }
          } catch (ovErr) {
            console.warn('[me] override lookup failed:', ovErr.message);
          }
        }

        // Touch last_login_at on every session revalidation. /me is called
        // on boot and on route changes, so this doubles as a reliable
        // "user is active" signal — critical because the auth callback only
        // fires on fresh OAuth, not on cached JWT sessions. Without this,
        // everyone with an existing session shows as "Never logged in"
        // until their JWT expires.
        //
        // We only bump login_count on the first INSERT (seed row); subsequent
        // refreshes just update the timestamp so we don't inflate the counter
        // to meaningless numbers. Fresh OAuth / email-login explicitly +1
        // the counter in their own code paths.
        try {
          await query(
            `INSERT INTO team_member_overrides (email, last_login_at, login_count)
             VALUES ($1, NOW(), 1)
             ON CONFLICT (email) DO UPDATE
             SET last_login_at = NOW(),
                 updated_at    = NOW()`,
            [authUser.email]
          );
        } catch (touchErr) {
          console.warn('[me] last_login touch failed:', touchErr.message);
        }
      }
    } catch (err) {
      console.warn('[me] DB lookup failed, using JWT claims:', err.message);
    }

    if (dbUser) {
      return NextResponse.json({
        id: dbUser.id, name: dbUser.name, initials: dbUser.initials, role: dbUser.role,
        team: dbUser.team, region: dbUser.region, country: dbUser.country,
        leadId: dbUser.lead_id, email: dbUser.email, avatarUrl: dbUser.avatar_url,
        isActive: dbUser.is_active, createdAt: dbUser.created_at, updatedAt: dbUser.updated_at,
      });
    }

    // Fallback to JWT claims when DB is unavailable. Note: we intentionally
    // leave team/region/country as null rather than defaulting to 'JTK'.
    // Hardcoding a default team caused announcement audiences to mis-route
    // for any authenticated user missing a members row — e.g. a NAM user
    // whose DB row hadn't been seeded would silently receive JTK popups
    // and miss the ones targeted to their actual team.
    const nameParts = (authUser.name || authUser.email.split('@')[0]).split(' ');
    const initials = nameParts.map(p => p.charAt(0).toUpperCase()).slice(0, 2).join('');

    return NextResponse.json({
      id: authUser.id || 0,
      name: authUser.name || authUser.email.split('@')[0],
      initials,
      role: authUser.role || 'member',
      team: null,
      region: null,
      country: null,
      leadId: null,
      email: authUser.email,
      avatarUrl: null,
      isActive: true,
      createdAt: null,
      updatedAt: null,
    });
  } catch (err) {
    console.error('[me]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
