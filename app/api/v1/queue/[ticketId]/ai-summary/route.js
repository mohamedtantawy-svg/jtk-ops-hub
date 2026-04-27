// ── GET /api/v1/queue/[ticketId]/ai-summary ──────────────────────────────────
// Generates a 2-3 sentence summary of a Zendesk ticket via Claude Haiku 4.5.
// Cached server-side per (ticketId + thread hash) for 10 minutes — when the
// thread changes (new comment), the cache key changes and a fresh summary
// is generated automatically.
//
// `?force=1` bypasses the cache (Regenerate button on the FE).
//
// Auth: standard scope check via queue-ticket-scope. Jira: 400 with
// reason 'jira_unsupported'.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import { checkQueueTicketScope } from '../../../../../../src/lib/queue-ticket-scope';
import { isZendeskConfigured } from '../../../../../../src/lib/zendesk-api';
import { cacheGet, cacheSet } from '../../../../../../src/lib/server-cache';
import { generateTicketSummary, isAISummaryConfigured } from '../../../../../../src/lib/ai-summary';

const ZD_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN || '';
const ZD_TOKEN = process.env.ZENDESK_API_TOKEN || '';
const ZD_EMAIL = process.env.ZENDESK_EMAIL || '';
const STALE_TTL_MS = 30 * 60_000;
const SUMMARY_TTL_MS = 10 * 60_000;

function isZendeskTicket(ticketId) {
  return ticketId.startsWith('ZD-');
}

// Find the ticket in the cached queue payload — gives us the metadata block
// (subject, status, country, etc.) without an extra Zendesk round trip.
function findTicketInCache(ticketId) {
  const sourceKey = isZendeskTicket(ticketId) ? 'queue_zendesk' : 'queue_jira';
  const combined = cacheGet('queue', STALE_TTL_MS);
  const perSource = cacheGet(sourceKey, STALE_TTL_MS);
  for (const pool of [combined?.items, perSource?.items]) {
    if (!pool) continue;
    const m = pool.find(t => t.id === ticketId);
    if (m) return m;
  }
  return null;
}

// Pull the last 5 comments + author names. Same shape the FE consumes — keeps
// the LLM input consistent with what the agent sees in the conversation panel.
async function fetchRecentComments(numericId) {
  if (!ZD_SUBDOMAIN || !ZD_TOKEN) return [];
  const auth = Buffer.from(`${ZD_EMAIL}/token:${ZD_TOKEN}`).toString('base64');
  const headers = { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' };

  const res = await fetch(
    `https://${ZD_SUBDOMAIN}.zendesk.com/api/v2/tickets/${numericId}/comments?sort_order=desc&per_page=10`,
    { headers, signal: AbortSignal.timeout(15_000) },
  );
  if (!res.ok) return [];
  const data = await res.json();
  const raw = data.comments || [];

  // Resolve author IDs → names (best-effort; falls back to "User #ID").
  const userIds = [...new Set(raw.map(c => c.author_id).filter(Boolean))];
  const userMap = {};
  if (userIds.length > 0) {
    try {
      const usersRes = await fetch(
        `https://${ZD_SUBDOMAIN}.zendesk.com/api/v2/users/show_many.json?ids=${userIds.join(',')}`,
        { headers, signal: AbortSignal.timeout(15_000) },
      );
      if (usersRes.ok) {
        const usersData = await usersRes.json();
        for (const u of (usersData.users || [])) userMap[u.id] = u;
      }
    } catch {}
  }

  return raw.map(c => {
    const u = userMap[c.author_id] || {};
    return {
      id: c.id,
      body: (c.body || '').substring(0, 4000),
      authorId: c.author_id,
      authorName: u.name || `User #${c.author_id || '?'}`,
      authorRole: u.role || null,
      public: c.public,
      createdAt: c.created_at,
    };
  });
}

// Hash the (ticketId + comment-thread fingerprint) into a cache key that
// auto-invalidates when the thread changes — even one new public reply
// flips the digest and forces a fresh summary on the next request.
function buildCacheKey(ticketId, ticket, comments) {
  const fingerprint = JSON.stringify({
    s: ticket?.subject || '',
    st: ticket?.zdStatus || ticket?.status || '',
    n: comments.length,
    last: comments.map(c => `${c.id}:${(c.body || '').length}`),
  });
  const digest = crypto.createHash('sha1').update(fingerprint).digest('hex').slice(0, 12);
  return `ai_summary:${ticketId}:${digest}`;
}

export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isAISummaryConfigured()) {
    return NextResponse.json({
      error: 'AI summary not configured',
      reason: 'missing_anthropic_api_key',
    }, { status: 503 });
  }
  if (!isZendeskConfigured()) {
    return NextResponse.json({ error: 'Zendesk API not configured' }, { status: 503 });
  }

  await ensureRosterHydrated();
  const { ticketId } = await params;
  if (!isZendeskTicket(ticketId)) {
    return NextResponse.json({
      error: 'AI summary is Zendesk-only',
      reason: 'jira_unsupported',
    }, { status: 400 });
  }

  const scope = await checkQueueTicketScope(ticketId, user);
  if (!scope.allowed) {
    return NextResponse.json({ error: 'Forbidden', reason: scope.reason }, { status: 403 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1';

  const ticket = findTicketInCache(ticketId);
  if (!ticket) {
    // No cached row — refuse rather than build a summary from a half-empty
    // payload. The FE can refresh the queue and retry; same pattern as the
    // actions endpoint's `unknown_ticket` reason.
    return NextResponse.json({ error: 'Ticket not in queue cache', reason: 'unknown_ticket' }, { status: 404 });
  }

  const numericId = ticketId.replace('ZD-', '');
  let comments = [];
  try {
    comments = await fetchRecentComments(numericId);
  } catch (err) {
    console.warn('[queue/ai-summary] comment fetch failed (proceeding with metadata only):', err.message);
  }

  const cacheKey = buildCacheKey(ticketId, ticket, comments);
  if (!force) {
    const cached = cacheGet(cacheKey, SUMMARY_TTL_MS);
    if (cached?.summary) {
      return NextResponse.json({ ...cached, cached: true });
    }
  }

  try {
    const result = await generateTicketSummary({ ticket, comments });
    cacheSet(cacheKey, result);
    return NextResponse.json({ ...result, cached: false });
  } catch (err) {
    console.error('[queue/ai-summary] generation failed:', err.message);
    return NextResponse.json({
      error: err.message || 'Summary generation failed',
    }, { status: err.status || 500 });
  }
}
