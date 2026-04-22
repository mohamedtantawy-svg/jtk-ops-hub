// ── POST /api/v1/calendar/oauth/start ───────────────────────────────────────
// Kick off the Calendar OAuth flow. The browser cannot navigate directly to
// an authenticated GET endpoint (top-level navigations don't send the
// Authorization bearer token), so instead:
//   1. Frontend POSTs here (bearer auth via middleware).
//   2. We generate a signed `state` param tying the redirect back to this
//      specific user's email.
//   3. We return the Google consent URL; the frontend then does
//      `window.location = data.authUrl` to hand off the browser.
//
// The matching /callback endpoint is bypassed in middleware (Google's
// redirect doesn't include our bearer) — it verifies identity via the
// state JWT instead.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { signState } from '../../../../../../src/lib/oauth-state';
import { buildAuthUrl, isCalendarConfigured } from '../../../../../../src/lib/google-calendar';

// Soft-launch gate. Keep in sync with src/components/nav/DeelTopNav.jsx and
// src/App.jsx (the same value is used to show the Calendar tab). Defence
// in depth — even if the nav somehow leaks the tab to another user, this
// route still refuses. Lowercase comparison to be safe.
const OWNER_EMAIL = 'mohamed.tantawy@deel.com';

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (user.email.toLowerCase() !== OWNER_EMAIL) {
    return NextResponse.json(
      { error: 'Calendar integration is in limited rollout' },
      { status: 403 }
    );
  }

  if (!isCalendarConfigured()) {
    return NextResponse.json(
      { error: 'Calendar OAuth is not configured on this server' },
      { status: 503 }
    );
  }

  try {
    const state = signState(user.email);
    const authUrl = buildAuthUrl(state);
    return NextResponse.json({ authUrl });
  } catch (err) {
    console.error('[calendar/oauth/start]', err.message);
    return NextResponse.json({ error: 'Failed to start OAuth' }, { status: 500 });
  }
}
