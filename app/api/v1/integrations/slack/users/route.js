// ── GET /api/v1/integrations/slack/users ──────────────────────────────────────
// List Slack users or look up by email
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listUsers, lookupUserByEmail, isSlackConfigured } from '../../../../../../src/lib/slack-api';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSlackConfigured()) {
    return NextResponse.json({ error: 'Slack API not configured' }, { status: 503 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get('email');

    if (email) {
      const result = await lookupUserByEmail(email);
      return NextResponse.json(result);
    }

    const result = await listUsers({ limit: searchParams.get('limit') || '200' });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[integrations/slack/users]', err.message);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
