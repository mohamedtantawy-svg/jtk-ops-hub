// ── Slack API client ─────────────────────────────────────────────────────────
// Server-side only. Uses Slack Web API with a bot token.
// Requires: channels:history, channels:read, chat:write, users:read scopes.

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_BASE = 'https://slack.com/api';

export function isSlackConfigured() {
  return !!SLACK_BOT_TOKEN;
}

/**
 * Generic Slack Web API wrapper.
 */
export async function slackFetch(method, body = {}) {
  if (!SLACK_BOT_TOKEN) {
    throw new Error('SLACK_BOT_TOKEN is not configured');
  }

  const res = await fetch(`${SLACK_BASE}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Slack HTTP ${res.status}`);
  }

  const data = await res.json();
  if (!data.ok) {
    const err = new Error(`Slack API error: ${data.error}`);
    err.slackError = data.error;
    throw err;
  }

  return data;
}

// ── Channels ─────────────────────────────────────────────────────────────────

export async function listChannels(params = {}) {
  return slackFetch('conversations.list', {
    types: params.types || 'public_channel',
    limit: params.limit || 100,
    exclude_archived: true,
    ...(params.cursor ? { cursor: params.cursor } : {}),
  });
}

export async function getChannelHistory(channelId, params = {}) {
  return slackFetch('conversations.history', {
    channel: channelId,
    limit: params.limit || 50,
    ...(params.oldest ? { oldest: params.oldest } : {}),
    ...(params.latest ? { latest: params.latest } : {}),
    ...(params.cursor ? { cursor: params.cursor } : {}),
  });
}

export async function getThreadReplies(channelId, threadTs) {
  return slackFetch('conversations.replies', {
    channel: channelId,
    ts: threadTs,
    limit: 100,
  });
}

// ── Messages ─────────────────────────────────────────────────────────────────

export async function sendMessage(channelId, text, opts = {}) {
  return slackFetch('chat.postMessage', {
    channel: channelId,
    text,
    ...(opts.thread_ts ? { thread_ts: opts.thread_ts } : {}),
    ...(opts.blocks ? { blocks: opts.blocks } : {}),
  });
}

// ── Search ───────────────────────────────────────────────────────────────────

export async function searchMessages(query, params = {}) {
  // Note: search.messages requires a user token, not bot token.
  // If using bot token, this will fail — need user OAuth token.
  return slackFetch('search.messages', {
    query,
    count: params.count || 50,
    sort: params.sort || 'timestamp',
    sort_dir: params.sort_dir || 'desc',
  });
}

// ── Users ────────────────────────────────────────────────────────────────────

export async function getUserInfo(userId) {
  return slackFetch('users.info', { user: userId });
}

export async function listUsers(params = {}) {
  return slackFetch('users.list', {
    limit: params.limit || 200,
    ...(params.cursor ? { cursor: params.cursor } : {}),
  });
}

export async function lookupUserByEmail(email) {
  return slackFetch('users.lookupByEmail', { email });
}

// ── Reactions ────────────────────────────────────────────────────────────────

export async function addReaction(channelId, timestamp, emoji) {
  return slackFetch('reactions.add', {
    channel: channelId,
    timestamp,
    name: emoji,
  });
}
