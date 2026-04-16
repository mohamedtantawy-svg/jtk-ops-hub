// ── POST /api/v1/integrations/slack/channels/[channelId]/send ─────────────────
// Send a message to a Slack channel
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../../../src/lib/auth-helpers';
import { sendMessage, isSlackConfigured } from '../../../../../../../../src/lib/slack-api';

export async function POST(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSlackConfigured()) {
    return NextResponse.json({ error: 'Slack API not configured' }, { status: 503 });
  }

  try {
    const { channelId } = await params;
    const body = await req.json();
    const { text, thread_ts, blocks } = body;

    if (!text && !blocks) {
      return NextResponse.json({ error: 'text or blocks required' }, { status: 400 });
    }

    const result = await sendMessage(channelId, text, { thread_ts, blocks });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[integrations/slack/send]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: err.status || 500 });
  }
}
