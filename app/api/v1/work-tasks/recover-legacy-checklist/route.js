// ── /api/v1/work-tasks/recover-legacy-checklist (2026-05-26) ───────────────
// Self-serve recovery for users whose PersonalChecklist items never made
// it into `personal_checklist_snapshots` before the PR #821 cutover, OR
// whose `migratePersonalChecklistIfNeeded` ran first against an empty
// snapshot and stamped the sentinel.
//
// Reported by Celine Taruc 2026-05-26 — "all of my to do's have been
// deleted under My Tasks, I don't know what happened but I believe its
// due to an update." Root cause: the migration sentinel
// (`checklist_migrated_for:<email>`) is stamped after the first work-
// tasks GET regardless of how many rows actually migrated. Once stamped,
// subsequent runs are skipped — so a user whose localStorage items
// reached the FE but never landed in the server snapshot loses every-
// thing on the cutover.
//
// Recovery flow (from BriefingMyTasks):
//   1. FE reads localStorage `ops_hub_checklist_v2:<email>` items.
//   2. FE POSTs the items to this endpoint.
//   3. Server merges them into `personal_checklist_snapshots`,
//      clears the migration sentinel, re-runs the migration helper.
//   4. The user's missing tasks reappear in BriefingMyTasks on next
//      reload — same `source = 'imported_checklist'` + `source_id`
//      dedup contract as the normal migration path, so users who
//      already migrated some rows don't get duplicates.

import { NextResponse } from 'next/server';
import { query, withTransaction } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { getCurrentDeptId } from '../../../../../src/lib/dept-scope';
import { migratePersonalChecklistIfNeeded } from '../../../../../src/lib/work-tasks-helpers';

// Mirror the PersonalChecklist API's sanitiser shape so an item written
// here matches what migratePersonalChecklistIfNeeded expects to read.
// See app/api/v1/personal-checklist/route.js for the canonical version.
const VALID_PRIORITIES = new Set(['urgent', 'high', 'normal', 'low']);
const MAX_ITEMS = 1000;
const MAX_TITLE_LEN = 500;
const MAX_DESC_LEN = 10_000;
const MAX_ID_LEN = 64;
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const idRaw = raw.id;
  const id = (typeof idRaw === 'string' || typeof idRaw === 'number')
    ? String(idRaw).slice(0, MAX_ID_LEN)
    : `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const deleted = !!raw.deleted;
  const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
  const updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt;
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

// Per-id last-write-wins merge — same shape as the canonical PUT handler.
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

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const deptId = await getCurrentDeptId(user, req);
  if (!deptId) {
    return NextResponse.json({ error: 'No department context — cannot recover tasks' }, { status: 400 });
  }

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const rawItems = Array.isArray(body?.items) ? body.items : null;
  if (!rawItems) return NextResponse.json({ error: 'items must be an array' }, { status: 400 });
  if (rawItems.length > MAX_ITEMS) {
    return NextResponse.json({ error: `Too many items (max ${MAX_ITEMS})` }, { status: 413 });
  }
  const incoming = rawItems.map(sanitizeItem).filter(Boolean);

  const lcEmail = String(user.email).toLowerCase();
  const sentinelKey = `checklist_migrated_for:${lcEmail}`;

  // Step 1 + 2 in one transaction: merge incoming items into the snapshot
  // so the migration helper picks them up, then drop the migration
  // sentinel so it re-runs. Wrapping both in a transaction prevents a
  // crash mid-recovery from leaving a stale sentinel pointing at a fresh
  // snapshot (which would block the helper from ever migrating the
  // newly-added items).
  let mergedCount = 0;
  try {
    mergedCount = await withTransaction(async (client) => {
      const sel = await client.query(
        `SELECT items FROM personal_checklist_snapshots
          WHERE LOWER(user_email) = LOWER($1) FOR UPDATE`,
        [user.email],
      );
      const existing = sel.rows.length > 0 && Array.isArray(sel.rows[0].items)
        ? sel.rows[0].items.map(sanitizeItem).filter(Boolean)
        : [];
      const merged = mergeItems(existing, incoming);
      await client.query(
        `INSERT INTO personal_checklist_snapshots (user_email, items, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (user_email)
           DO UPDATE SET items = EXCLUDED.items, updated_at = NOW()`,
        [user.email, JSON.stringify(merged)],
      );
      // Drop the sentinel so migratePersonalChecklistIfNeeded re-runs
      // against the fresh snapshot below.
      await client.query(`DELETE FROM app_settings WHERE key = $1`, [sentinelKey]);
      return merged.length;
    });
  } catch (err) {
    console.error('[recover-legacy-checklist] merge/clear failed:', err?.message);
    return NextResponse.json({ error: 'Recovery snapshot write failed' }, { status: 500 });
  }

  // Step 3: re-run the migration. Idempotent on (creator_email, source_id)
  // so a partial earlier migration just bumps `skipped` — users who
  // already had some items recovered won't see duplicates.
  let migrationResult = { migrated: 0, skipped: 0 };
  try {
    migrationResult = await migratePersonalChecklistIfNeeded(user.email, deptId);
  } catch (err) {
    console.error('[recover-legacy-checklist] migration failed:', err?.message);
    // Sentinel got cleared so a subsequent /work-tasks GET will retry
    // the migration automatically — surface a 500 so the FE can show
    // the user a "retry" affordance, but DB state is recoverable.
    return NextResponse.json({ error: 'Recovery migration failed — please retry' }, { status: 500 });
  }

  return NextResponse.json({
    snapshotItems: mergedCount,
    incomingItems: incoming.length,
    migrated: migrationResult.migrated || 0,
    skipped: migrationResult.skipped || 0,
  });
}
