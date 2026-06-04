// ── /api/v1/settings/queue-priority ───────────────────────────────────────
// Persists the "Priority of the day" message shown on the Workspace landing
// board. Per-department (Mohamed 2026-06-04): storage + the HRX-inheritance
// rule live in src/lib/dept-settings.js; this route reads/writes
// `queue_priority_of_day:<deptId>`. Other depts start from the generic default
// until an admin sets one for them.
//
// GET — public read (any signed-in user). 30s server cache + `updatedAt`.
// PUT — admin only. Stores `{ message, headline }`. Empty clears the banner.

import { NextResponse } from 'next/server';
import { getAuthUser, requireRole } from '../../../../../src/lib/auth-helpers';
import { getCurrentDeptSlugAndId } from '../../../../../src/lib/dept-scope';
import { deptSettingKey, readDeptSettingRow } from '../../../../../src/lib/dept-settings';
import { cacheGet, cacheSet, cacheDel } from '../../../../../src/lib/server-cache';

const BASE_KEY = 'queue_priority_of_day';
const CACHE_TTL = 30_000; // 30s — same cadence as queue-sla and capacity
const MAX_HEADLINE = 80;
const MAX_MESSAGE = 600;

const DEFAULT_PRIORITY = {
  // Sensible, dept-agnostic default so the banner always renders something on
  // first load — admin can overwrite per dept at any time.
  headline: "Today's focus",
  message: 'Clear breaches first across every queue. Then tackle Zendesk, then Workbench, then everything else. Stay paired up — escalate fast.',
};

async function getDb() {
  if (!process.env.DATABASE_URL) return null;
  const { query } = await import('../../../../../src/lib/db');
  return { query };
}

async function resolveScope(user, req) {
  const scope = await getCurrentDeptSlugAndId(user, req).catch(() => null);
  const deptId = scope?.deptId || null;
  return { deptId, deptSlug: scope?.deptSlug || null, key: deptSettingKey(BASE_KEY, deptId) };
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

  const { deptId, deptSlug, key } = await resolveScope(user, req);

  const cached = cacheGet(key, CACHE_TTL);
  if (cached) return NextResponse.json(cached);

  let stored = null;
  let updatedBy = null;
  let updatedAt = null;
  try {
    const row = await readDeptSettingRow(BASE_KEY, deptId, deptSlug);
    if (row) {
      stored = row.value;
      updatedBy = row.updated_by;
      updatedAt = row.updated_at;
    }
  } catch (err) {
    console.warn('[queue-priority] DB read failed:', err.message);
  }

  const result = {
    priority: withDefaults(stored),
    updatedBy,
    updatedAt,
    isDefault: !stored,
  };
  cacheSet(key, result);
  return NextResponse.json(result);
}

export async function PUT(req) {
  // Admin only. Sets a per-dept "what the whole team should focus on" — a
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

  const { key } = await resolveScope(user, req);

  try {
    await db.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ($3, $1::jsonb, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_by = $2, updated_at = NOW()`,
      [JSON.stringify(sanitized), user.email, key],
    );
  } catch (err) {
    console.error('[queue-priority] DB write failed:', err.message);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }

  cacheDel(key);
  const result = {
    priority: withDefaults(sanitized),
    updatedBy: user.email,
    updatedAt: new Date().toISOString(),
    isDefault: false,
  };
  cacheSet(key, result);
  return NextResponse.json(result);
}
