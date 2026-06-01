// ── POST /api/v1/handovers/bulk/accept ─────────────────────────────────
// Coverer bulk-accepts multiple handovers in one round-trip. Mirrors the
// per-id POST /handovers/:id/accept logic exactly — same row lookup, same
// idempotency on already-accepted, same recompute → APPROVED transition
// when the last coverer accepts — but applied to a list of ids so a
// coverer covering N sibling handovers (e.g. one logical vacation split
// upstream by Deel into per-day rows) doesn't have to click N times.
//
// Origin: Olga Pastuszak feedback 2026-05-29 — "Belu was only able to
// approve 1 of these individual requests. The remaining requests are
// locked on her end."
//
// Each id runs in its own transaction so a partial failure (e.g. one
// row already in a terminal state) doesn't block the others. Returns
// per-id `accepted` / `error` so the FE can surface partial success.

import { NextResponse } from 'next/server';
import { withTransaction } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import {
  loadHandoverWithDetails,
  findCovererRow,
  writeLog,
  notifyUser,
  recomputeAfterCovererChange,
} from '../../../../../../src/lib/handover-server';
import {
  HANDOVER_STATUSES,
  HANDOVER_EVENT_TYPES,
  HANDOVER_NOTIFICATION_TYPES,
} from '../../../../../../src/lib/handover-helpers';

const lc = (v) => (v || '').toLowerCase().trim();
const MAX_BATCH = 50;

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
}

async function acceptOne(id, user) {
  return withTransaction(async (client) => {
    const handover = await loadHandoverWithDetails(id, { client });
    if (handover.status !== HANDOVER_STATUSES.PENDING_COVERAGE_ACCEPTANCE) {
      throw Object.assign(new Error(`Cannot accept — handover status is ${handover.status}`), { status: 409 });
    }
    const row = await findCovererRow(handover.id, user.email, client);
    if (!row) {
      throw Object.assign(new Error('You are not listed as a coverer on this handover'), { status: 403 });
    }
    if (row.acceptance_status === 'accepted') {
      // Idempotent — return current state without log spam.
      return handover;
    }
    await client.query(
      `UPDATE handover_coverers
          SET acceptance_status = 'accepted',
              accepted_at = NOW(),
              declined_at = NULL,
              decline_reason = NULL
        WHERE id = $1`,
      [row.id],
    );
    await writeLog(client, handover.id, HANDOVER_EVENT_TYPES.COVERER_ACCEPTED, user, {
      coverer_email: lc(user.email),
      via: 'bulk_accept',
    });
    await notifyUser(client, handover.requester_email,
      HANDOVER_NOTIFICATION_TYPES.COVERER_ACCEPTED, handover.id, {
        title: 'Coverer accepted',
        body: `${user.name || user.email} accepted the handover.`,
        actor: user,
      });
    await recomputeAfterCovererChange(client, handover, user);
    return loadHandoverWithDetails(handover.id, { client });
  });
}

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try { body = await req.json(); } catch {}
  const ids = Array.isArray(body?.ids) ? body.ids : null;
  if (!ids || ids.length === 0) {
    return NextResponse.json({ error: 'ids[] required' }, { status: 400 });
  }
  if (ids.length > MAX_BATCH) {
    return NextResponse.json({ error: `Batch too large (max ${MAX_BATCH})` }, { status: 400 });
  }
  // Dedup + validate up front so a single typo doesn't run any transactions.
  const cleanIds = Array.from(new Set(ids.map(String))).filter(isUuid);
  if (cleanIds.length !== ids.length) {
    return NextResponse.json({ error: 'One or more ids are not valid UUIDs' }, { status: 400 });
  }

  const results = [];
  let accepted = 0;
  let failed = 0;
  for (const id of cleanIds) {
    try {
      const handover = await acceptOne(id, user);
      results.push({ id, accepted: true, status: handover.status });
      accepted++;
    } catch (err) {
      const status = err?.status || 500;
      if (status >= 500) console.error('[handovers/bulk/accept]', id, err.message);
      results.push({
        id,
        accepted: false,
        error: err?.message || 'Internal server error',
        status,
      });
      failed++;
    }
  }
  return NextResponse.json({ accepted, failed, total: cleanIds.length, results });
}
