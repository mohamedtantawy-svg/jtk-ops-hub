import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { getCurrentDeptSlugAndId } from '../../../../../src/lib/dept-scope';
import { deptSettingKey, readDeptSettingRow } from '../../../../../src/lib/dept-settings';
import { cacheGet, cacheSet } from '../../../../../src/lib/server-cache';

// Per-department setting (Mohamed 2026-06-04: "each dept should have its own
// manager on call ... stop copying HRX across departments"). Storage + the
// HRX-inheritance rule live in src/lib/dept-settings.js; this route just
// resolves the caller's dept and reads/writes its `manager_on_call:<deptId>`
// value. The server cache is keyed per dept so one dept never serves another.
const BASE_KEY = 'manager_on_call';
const CACHE_TTL = 5000; // 5 seconds — short for near-real-time sync

const DEFAULT_MOC = { name: 'Omar Khalil', email: 'omar.khalil@deel.com', initials: 'OK' };

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

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { deptId, deptSlug, key } = await resolveScope(user, req);

  const cached = cacheGet(key, CACHE_TTL);
  if (cached) return NextResponse.json(cached);

  try {
    const row = await readDeptSettingRow(BASE_KEY, deptId, deptSlug);
    if (row) {
      const result = { ...row.value, updatedBy: row.updated_by, updatedAt: row.updated_at };
      cacheSet(key, result);
      return NextResponse.json(result);
    }
  } catch (err) {
    console.warn('[manager-on-call] DB read failed:', err.message);
  }

  // Fallback — no MOC set for this dept yet.
  cacheSet(key, DEFAULT_MOC);
  return NextResponse.json(DEFAULT_MOC);
}

export async function PUT(req) {
  // Open to any authenticated user (2026-05-07): per Mohamed's spec
  // "anyone can change [the manager on call]". Authentication is still
  // required so we can attribute the change in `updated_by` for audit.
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { name, email, initials, avatarUrl } = body;
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const value = {
    name,
    email: email || '',
    initials: initials || name.split(' ').map(w => w[0]?.toUpperCase()).slice(0, 2).join(''),
    avatarUrl: avatarUrl || '',
  };

  const { key } = await resolveScope(user, req);

  const db = await getDb();
  if (db) {
    try {
      await db.query(
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
         VALUES ($3, $1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = NOW()`,
        [JSON.stringify(value), user.email, key]
      );
    } catch (err) {
      console.error('[manager-on-call] DB write failed:', err.message);
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
    }
  }

  const result = { ...value, updatedBy: user.email, updatedAt: new Date().toISOString() };
  cacheSet(key, result);
  return NextResponse.json(result);
}
