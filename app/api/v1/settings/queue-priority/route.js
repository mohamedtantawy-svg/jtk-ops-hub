// ── /api/v1/settings/queue-priority ───────────────────────────────────────
// Persists the "Priority of the day" message that the Workspace landing
// board shows to every team member. Stored in `app_settings` under the
// key `queue_priority_of_day`.
//
// GET — public read (any signed-in user). 30s server cache + ETag-style
//        `updatedAt` so the FE can show "Set by X · 12 min ago".
// PUT — admin only. Stores `{ message, headline }`; both are plain text,
//        capped at sensible lengths. Empty `message` clears the banner.

import { NextResponse } from 'next/server';
import { getAuthUser, requireRole } from '../../../../../src/lib/auth-helpers';
import { cacheGet, cacheSet, cacheDel } from '../../../../../src/lib/server-cache';

const CACHE_KEY = 'queue_priority_of_day';
const CACHE_TTL = 30_000; // 30s — same cadence as queue-sla and capacity
const MAX_HEADLINE = 80;
const MAX_MESSAGE = 600;

const DEFAULT_PRIORITY = {
  // Ships with a sensible default so the banner always renders something on
  // first load — admin can overwrite at any time.
  headline: "Today's focus",
  message: 'Clear breaches first across every queue. Then tackle Zendesk, then Workbench, then everything else. Stay paired up — escalate fast.',
};

async function getDb() {
  if (!process.env.DATABASE_URL) return null;
  const { query } = await import('../../../../../src/lib/db');
  return { query };
}

function sanitize(input) {
  if (!input || typeof input !== 'object') return null;
  const headline = typeof input.headline === 'string'
    ? input.headline.trim().slice(0, MAX_HEADLINE)
    : '';
  const message = typeof input.message === 'string'
    ? input.message.trim().slice(0, MAX_MESSAGE)
    : '';
  if (!headline && !message) return null;
  return { headline, message };
}

function withDefaults(stored) {
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_PRIORITY };
  return {
    headline: stored.headline || DEFAULT_PRIORITY.headline,
    message: stored.message || DEFAULT_PRIORITY.message,
  };
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cached = cacheGet(CACHE_KEY, CACHE_TTL);
  if (cached) return NextResponse.json(cached);

  const db = await getDb();
  let stored = null;
  let updatedBy = null;
  let updatedAt = null;
  if (db) {
    try {
      const { rows } = await db.query(
        "SELECT value, updated_by, updated_at FROM app_settings WHERE key = 'queue_priority_of_day'",
      );
      if (rows.length > 0) {
        stored = rows[0].value;
        updatedBy = rows[0].updated_by;
        updatedAt = rows[0].updated_at;
      }
    } catch (err) {
      console.warn('[queue-priority] DB read failed:', err.message);
    }
  }

  const result = {
    priority: withDefaults(stored),
    updatedBy,
    updatedAt,
    isDefault: !stored,
  };
  cacheSet(CACHE_KEY, result);
  return NextResponse.json(result);
}

export async function PUT(req) {
  // Admin only. Ops Hub directors / regional managers don't get this dial —
  // it sets a global "what the whole team should focus on" and that's a
  // single-owner decision per Mohamed's 2026-05-05 ask.
  const { authorized, user, status, error } = requireRole(req, 'admin');
  if (!authorized) return NextResponse.json({ error }, { status });

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const sanitized = sanitize(body?.priority || body);
  if (!sanitized) {
    return NextResponse.json(
      { error: 'priority.headline or priority.message is required' },
      { status: 400 },
    );
  }

  const db = await getDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  try {
    await db.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ('queue_priority_of_day', $1::jsonb, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_by = $2, updated_at = NOW()`,
      [JSON.stringify(sanitized), user.email],
    );
  } catch (err) {
    console.error('[queue-priority] DB write failed:', err.message);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }

  cacheDel(CACHE_KEY);
  const result = {
    priority: withDefaults(sanitized),
    updatedBy: user.email,
    updatedAt: new Date().toISOString(),
    isDefault: false,
  };
  cacheSet(CACHE_KEY, result);
  return NextResponse.json(result);
}
