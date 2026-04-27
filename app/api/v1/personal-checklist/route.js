import { NextResponse } from 'next/server';
import { query, withTransaction } from '../../../../src/lib/db';
import { getAuthUser } from '../../../../src/lib/auth-helpers';

// The snapshot table holds the full items array as JSONB, but the PUT
// handler treats the array as a CRDT-style set keyed by item.id. Each
// incoming PUT is *merged* into the existing server snapshot — for every
// id present in either side, the higher item.updatedAt wins. Items absent
// from the incoming payload are NOT deleted (they may be from a different
// device); deletes must be explicit via a `deleted: true` tombstone.
//
// This guarantees no data loss when two devices edit concurrently:
// device A's adds + device B's adds end up unioned, and device A deleting
// one item still tombstones it for B. Tombstones older than
// TOMBSTONE_TTL_MS are pruned during the merge.
const VALID_PRIORITIES = new Set(['urgent', 'high', 'normal', 'low']);
const MAX_ITEMS = 1000;
const MAX_TITLE_LEN = 500;
const MAX_DESC_LEN = 10_000;
const MAX_ID_LEN = 64;
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const idRaw = raw.id;
  const id = (typeof idRaw === 'string' || typeof idRaw === 'number')
    ? String(idRaw).slice(0, MAX_ID_LEN)
    : `srv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const deleted = !!raw.deleted;
  const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
  const updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt;

  // Tombstones may carry no other fields (the client only needs the id +
  // timestamps to suppress the row). Keep them minimal to save bytes.
  if (deleted) {
    return { id, deleted: true, createdAt, updatedAt };
  }

  const title = typeof raw.title === 'string' ? raw.title.slice(0, MAX_TITLE_LEN) : '';
  if (!title.trim()) return null;
  const description = typeof raw.description === 'string' ? raw.description.slice(0, MAX_DESC_LEN) : '';
  const dueDate = typeof raw.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.dueDate) ? raw.dueDate : null;
  const priority = typeof raw.priority === 'string' && VALID_PRIORITIES.has(raw.priority) ? raw.priority : 'normal';
  const done = !!raw.done;
  return { id, title, description, dueDate, priority, done, createdAt, updatedAt };
}

// Per-id last-write-wins merge. Drops tombstones older than TOMBSTONE_TTL_MS
// so the snapshot doesn't grow without bound.
function mergeItems(existing, incoming) {
  const map = new Map();
  for (const it of existing) map.set(String(it.id), it);
  for (const it of incoming) {
    const key = String(it.id);
    const cur = map.get(key);
    if (!cur || (Number(it.updatedAt) || 0) >= (Number(cur.updatedAt) || 0)) {
      map.set(key, it);
    }
  }
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  const out = [];
  for (const it of map.values()) {
    if (it.deleted && (Number(it.updatedAt) || 0) < cutoff) continue;
    out.push(it);
  }
  return out;
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { rows } = await query(
      `SELECT items, updated_at
         FROM personal_checklist_snapshots
        WHERE LOWER(user_email) = LOWER($1)
        LIMIT 1`,
      [user.email]
    );
    if (rows.length === 0) {
      return NextResponse.json({ items: [], updatedAt: null });
    }
    return NextResponse.json({
      items: Array.isArray(rows[0].items) ? rows[0].items : [],
      updatedAt: rows[0].updated_at,
    });
  } catch (err) {
    console.error('[personal-checklist GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PUT(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const rawItems = Array.isArray(body?.items) ? body.items : null;
  if (!rawItems) return NextResponse.json({ error: 'items must be an array' }, { status: 400 });
  if (rawItems.length > MAX_ITEMS) {
    return NextResponse.json({ error: `Too many items (max ${MAX_ITEMS})` }, { status: 413 });
  }

  const incoming = rawItems.map(sanitizeItem).filter(Boolean);

  try {
    // Read-merge-write inside a transaction so two near-simultaneous PUTs
    // can't clobber each other. The row is keyed by user_email so the lock
    // is naturally per-user.
    const result = await withTransaction(async (client) => {
      const sel = await client.query(
        `SELECT items FROM personal_checklist_snapshots
          WHERE LOWER(user_email) = LOWER($1) FOR UPDATE`,
        [user.email]
      );
      const existing = sel.rows.length > 0 && Array.isArray(sel.rows[0].items)
        ? sel.rows[0].items.map(sanitizeItem).filter(Boolean)
        : [];
      const merged = mergeItems(existing, incoming);
      const ins = await client.query(
        `INSERT INTO personal_checklist_snapshots (user_email, items, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (user_email)
           DO UPDATE SET items = EXCLUDED.items, updated_at = NOW()
         RETURNING items, updated_at`,
        [user.email, JSON.stringify(merged)]
      );
      return ins.rows[0];
    });

    return NextResponse.json({
      items: Array.isArray(result.items) ? result.items : [],
      updatedAt: result.updated_at,
    });
  } catch (err) {
    console.error('[personal-checklist PUT]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
