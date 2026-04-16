// ── GET /api/v1/integrations/slack/channels ──────────────────────────────────
// List Slack channels the bot is a member of
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listChannels, isSlackConfigured } from '../../../../../../src/lib/slack-api';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSlackConfigured()) {
    return NextResponse.json({ error: 'Slack API not configured' }, { status: 503 });
  }

  try {
    const result = await listChannels();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[integrations/slack/channels]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: err.status || 500 });
  }
}
