// ── /api/v1/settings/capacity ──────────────────────────────────────────────
// Persists the per-agent capacity thresholds used by the Briefing health
// score and the Team-tab workload bands. Single row in app_settings keyed
// 'queue_capacity_thresholds' as JSONB:
//   {
//     "lowMax":  40,    // < lowMax → Low (blue)   — under-utilised
//     "highMin": 100    // > highMin → High (red)  — burnout risk
//   }
// Anything in [lowMax, highMin] is "Good" (green near lowMax, yellow as it
// approaches highMin). Director / RM / TL can edit; everyone else reads.

import { NextResponse } from 'next/server';
import { getAuthUser, requireRole } from '../../../../../src/lib/auth-helpers';
import { cacheGet, cacheSet, cacheDel } from '../../../../../src/lib/server-cache';

const CACHE_KEY = 'queue_capacity_thresholds';
const CACHE_TTL = 30_000; // 30s — same balance as the SLA settings cache

const DEFAULT_CAPACITY = { lowMax: 40, highMin: 100 };

async function getDb() {
  if (!process.env.DATABASE_URL) return null;
  const { query } = await import('../../../../../src/lib/db');
  return { query };
}

// Sanitise the incoming payload — both values must be positive integers,
// `lowMax` must be strictly less than `highMin` (otherwise the "Good" band
// is empty and every agent renders as either Low or High). Caps each value
// at 1000 to defend against typos like "40000".
function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const lowMax = Number.isFinite(raw.lowMax) ? Math.round(raw.lowMax) : null;
  const highMin = Number.isFinite(raw.highMin) ? Math.round(raw.highMin) : null;
  if (!Number.isFinite(lowMax) || lowMax <= 0) return null;
  if (!Number.isFinite(highMin) || highMin <= 0) return null;
  if (lowMax >= highMin) return null;
  const MAX = 1000;
  return { lowMax: Math.min(MAX, lowMax), highMin: Math.min(MAX, highMin) };
}

function mergeWithDefaults(stored) {
  return {
    lowMax: Number.isFinite(stored?.lowMax) && stored.lowMax > 0 ? stored.lowMax : DEFAULT_CAPACITY.lowMax,
    highMin: Number.isFinite(stored?.highMin) && stored.highMin > 0 ? stored.highMin : DEFAULT_CAPACITY.highMin,
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
        "SELECT value, updated_by, updated_at FROM app_settings WHERE key = 'queue_capacity_thresholds'"
      );
      if (rows.length > 0) {
        stored = rows[0].value;
        updatedBy = rows[0].updated_by;
        updatedAt = rows[0].updated_at;
      }
    } catch (err) {
      console.warn('[capacity] DB read failed:', err.message);
    }
  }

  const result = { capacity: mergeWithDefaults(stored), updatedBy, updatedAt, defaults: DEFAULT_CAPACITY };
  cacheSet(CACHE_KEY, result);
  return NextResponse.json(result);
}

export async function PUT(req) {
  // Mirrors the queue-sla route's edit gate so directors / RMs / TLs all
  // share the same dial.
  const { authorized, user, status, error } = requireRole(req, 'admin', 'regional_manager', 'manager', 'team_lead');
  if (!authorized) return NextResponse.json({ error }, { status });

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const incoming = body?.capacity || body || {};
  const sanitized = sanitize(incoming);
  if (!sanitized) {
    return NextResponse.json(
      { error: 'Invalid capacity payload — lowMax and highMin must be positive integers, lowMax < highMin' },
      { status: 400 },
    );
  }

  const db = await getDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  try {
    await db.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ('queue_capacity_thresholds', $1::jsonb, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_by = $2, updated_at = NOW()`,
      [JSON.stringify(sanitized), user.email]
    );
  } catch (err) {
    console.error('[capacity] DB write failed:', err.message);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }

  cacheDel(CACHE_KEY);
  const result = {
    capacity: mergeWithDefaults(sanitized),
    updatedBy: user.email,
    updatedAt: new Date().toISOString(),
    defaults: DEFAULT_CAPACITY,
  };
  cacheSet(CACHE_KEY, result);
  return NextResponse.json(result);
}
