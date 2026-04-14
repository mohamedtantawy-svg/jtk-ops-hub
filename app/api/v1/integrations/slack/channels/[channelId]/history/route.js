// ── GET /api/v1/integrations/slack/channels/[channelId]/history ───────────────
// Get message history for a specific Slack channel
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../../../src/lib/auth-helpers';
import { getChannelHistory, getThreadReplies, isSlackConfigured } from '../../../../../../../../src/lib/slack-api';

export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSlackConfigured()) {
    return NextResponse.json({ error: 'Slack API not configured' }, { status: 503 });
  }

  try {
    const { channelId } = await params;
    const { searchParams } = new URL(req.url);
    const threadTs = searchParams.get('thread_ts');

    let result;
    if (threadTs) {
      result = await getThreadReplies(channelId, threadTs);
    } else {
      result = await getChannelHistory(channelId, {
        limit: searchParams.get('limit') || '50',
        oldest: searchParams.get('oldest'),
        latest: searchParams.get('latest'),
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[integrations/slack/history]', err.message);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
