import { NextResponse } from 'next/server';
import { getAuthUser, requireRole } from '../../../../../src/lib/auth-helpers';
import { cacheGet, cacheSet, cacheDel } from '../../../../../src/lib/server-cache';

// Persisted in app_settings (key='queue_sla_thresholds') as JSONB. Keys are
// queue ids; activeMins is the SLA window from the relevant anchor (request
// reply / update / creation as documented per queue), pausedMins is the
// window from pausedAt for queues that surface a pause state. All values are
// MINUTES so the FE can multiply into milliseconds and the queue/route.js
// can pass them directly into slaMinsOverride.
const CACHE_KEY = 'queue_sla_thresholds';
const CACHE_TTL = 30_000; // 30s — balances UX speed vs DB load
// Split offboarding into termination + resignation per Mohamed's 2026-05-01
// spec — the two paths have different operating windows (14d vs 5d) so they
// need to be tunable independently. Legacy `offboarding` is no longer a
// valid key; mergeWithDefaults seeds the new split keys with the spec
// defaults if no override exists yet.
const VALID_QUEUES = new Set([
  'zendesk', 'jira', 'workbench', 'amendments', 'redlines', 'onboarding',
  'offboarding_termination', 'offboarding_resignation',
  'incentive_plans',
]);

const DEFAULT_SLA = {
  // All windows below are BUSINESS-DAY minutes (Sat/Sun excluded).
  zendesk:                 { activeMins: 1440,  pausedMins: 2880 },  // 24h active / 48h paused (pending/hold)
  jira:                    { activeMins: 2880 },                     // 48h from latest update
  workbench:               { activeMins: 2880,  pausedMins: 2880 },  // 48h from creation / 48h paused
  amendments:              { activeMins: 1440,  pausedMins: 2880 },  // 24h active / 48h paused
  redlines:                { activeMins: 7200,  pausedMins: 2880 },  // 5d active / 48h paused
  onboarding:              { activeMins: 1440,  pausedMins: 2880 },  // 24h from task initiated / 48h paused
  offboarding_termination: { activeMins: 20160, pausedMins: 2880 },  // 14d active / 48h paused
  offboarding_resignation: { activeMins: 7200,  pausedMins: 2880 },  // 5d active / 48h paused
  incentive_plans:         { activeMins: 7200,  pausedMins: 2880 },  // 5d active / 48h paused (mirrors redlines)
};

async function getDb() {
  if (!process.env.DATABASE_URL) return null;
  const { query } = await import('../../../../../src/lib/db');
  return { query };
}

// Sanitize one queue's config — drops anything that isn't a positive integer.
// Returns a partial object so missing fields fall back to the default at
// merge time. Caps at 90 days (129600 mins) so a typo can't lock everyone
// out for years.
function sanitizeQueueConfig(raw, queueId) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  const MAX = 90 * 24 * 60;
  if (Number.isFinite(raw.activeMins) && raw.activeMins > 0) {
    out.activeMins = Math.min(MAX, Math.round(raw.activeMins));
  }
  // Only the queues that have a paused branch in DEFAULT_SLA accept pausedMins.
  if (DEFAULT_SLA[queueId]?.pausedMins !== undefined
      && Number.isFinite(raw.pausedMins) && raw.pausedMins > 0) {
    out.pausedMins = Math.min(MAX, Math.round(raw.pausedMins));
  }
  return out;
}

function mergeWithDefaults(stored) {
  const out = {};
  for (const queueId of Object.keys(DEFAULT_SLA)) {
    out[queueId] = { ...DEFAULT_SLA[queueId], ...(stored?.[queueId] || {}) };
  }
  return out;
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
        "SELECT value, updated_by, updated_at FROM app_settings WHERE key = 'queue_sla_thresholds'"
      );
      if (rows.length > 0) {
        stored = rows[0].value;
        updatedBy = rows[0].updated_by;
        updatedAt = rows[0].updated_at;
      }
    } catch (err) {
      console.warn('[queue-sla] DB read failed:', err.message);
    }
  }

  const result = { sla: mergeWithDefaults(stored), updatedBy, updatedAt, defaults: DEFAULT_SLA };
  cacheSet(CACHE_KEY, result);
  return NextResponse.json(result);
}

export async function PUT(req) {
  // Only managers (admin, RM, manager-alias, or TL for trial) can edit. TLs
  // can edit per Pilar's request to give regional leads the same dial.
  const { authorized, user, status, error } = requireRole(req, 'admin', 'regional_manager', 'manager', 'team_lead');
  if (!authorized) return NextResponse.json({ error }, { status });

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const incoming = body?.sla || body || {};
  const sanitized = {};
  for (const queueId of Object.keys(incoming)) {
    if (!VALID_QUEUES.has(queueId)) continue;
    const cfg = sanitizeQueueConfig(incoming[queueId], queueId);
    if (Object.keys(cfg).length > 0) sanitized[queueId] = cfg;
  }

  const db = await getDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  try {
    await db.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ('queue_sla_thresholds', $1::jsonb, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_by = $2, updated_at = NOW()`,
      [JSON.stringify(sanitized), user.email]
    );
  } catch (err) {
    console.error('[queue-sla] DB write failed:', err.message);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }

  cacheDel(CACHE_KEY);
  // Return the FULL effective config (defaults + overrides) so the FE updates
  // its cache without an extra round trip.
  const result = {
    sla: mergeWithDefaults(sanitized),
    updatedBy: user.email,
    updatedAt: new Date().toISOString(),
    defaults: DEFAULT_SLA,
  };
  cacheSet(CACHE_KEY, result);
  return NextResponse.json(result);
}
