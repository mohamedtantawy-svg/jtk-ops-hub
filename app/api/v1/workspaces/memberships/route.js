// GET /api/v1/workspaces/memberships
//
// Returns the authenticated user's active memberships across all non-HR
// workspaces. Used by the frontend WorkspaceRouter to (a) decide which
// workspace to render and (b) gate the access-denied check.
//
// Auth: any authenticated session. No admin requirement — every user is
// allowed to know which workspaces they themselves are in.

import { NextResponse } from 'next/server';

import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { getMembershipsForEmail } from '../../../../../src/lib/workspace-members';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const memberships = await getMembershipsForEmail(user.email);
    return NextResponse.json(
      { memberships, email: user.email },
      // Short cache: clients can re-fetch this on workspace switch / admin
      // change. Don't cache aggressively or stale rosters will lock users out
      // after an admin removes them.
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    );
  } catch (err) {
    console.error('[workspaces:memberships]', err);
    return NextResponse.json({ error: 'Failed to load memberships' }, { status: 500 });
  }
}
