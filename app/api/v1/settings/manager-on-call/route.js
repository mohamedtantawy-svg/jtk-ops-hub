import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { cacheGet, cacheSet } from '../../../../../src/lib/server-cache';

const CACHE_KEY = 'manager_on_call';
const CACHE_TTL = 5000; // 5 seconds — short for near-real-time sync

const DEFAULT_MOC = { name: 'Omar Khalil', email: 'omar.khalil@deel.com', initials: 'OK' };

async function getDb() {
  if (!process.env.DATABASE_URL) return null;
  const { query } = await import('../../../../../src/lib/db');
  return { query };
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Check cache first
  const cached = cacheGet(CACHE_KEY, CACHE_TTL);
  if (cached) return NextResponse.json(cached);

  // Try DB
  const db = await getDb();
  if (db) {
    try {
      const { rows } = await db.query("SELECT value, updated_by, updated_at FROM app_settings WHERE key = 'manager_on_call'");
      if (rows.length > 0) {
        const result = { ...rows[0].value, updatedBy: rows[0].updated_by, updatedAt: rows[0].updated_at };
        cacheSet(CACHE_KEY, result);
        return NextResponse.json(result);
      }
    } catch (err) {
      console.warn('[manager-on-call] DB read failed:', err.message);
    }
  }

  // Fallback
  cacheSet(CACHE_KEY, DEFAULT_MOC);
  return NextResponse.json(DEFAULT_MOC);
}

export async function PUT(req) {
  // Open to any authenticated user (2026-05-07): per Mohamed's spec
  // "anyone can change [the manager on call]". The previous role gate
  // required admin / RM / manager / TL — kept agents from rotating MOC
  // when none of the managers were available. Authentication is still
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

  const db = await getDb();
  if (db) {
    try {
      await db.query(
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
         VALUES ('manager_on_call', $1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = NOW()`,
        [JSON.stringify(value), user.email]
      );
    } catch (err) {
      console.error('[manager-on-call] DB write failed:', err.message);
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
    }
  }

  const result = { ...value, updatedBy: user.email, updatedAt: new Date().toISOString() };
  cacheSet(CACHE_KEY, result);
  return NextResponse.json(result);
}
