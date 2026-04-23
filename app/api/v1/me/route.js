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

    // Fallback to JWT claims when DB is unavailable
    const nameParts = (authUser.name || authUser.email.split('@')[0]).split(' ');
    const initials = nameParts.map(p => p.charAt(0).toUpperCase()).slice(0, 2).join('');

    return NextResponse.json({
      id: authUser.id || 0,
      name: authUser.name || authUser.email.split('@')[0],
      initials,
      role: authUser.role || 'member',
      team: 'JTK',
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
